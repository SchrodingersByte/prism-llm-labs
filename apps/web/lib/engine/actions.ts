/**
 * Persistence + lookup layer for recommendation_actions — closes the Model
 * Intelligence Engine loop (see migration 20260625_recommendation_actions.sql
 * for the full rationale on why this table exists).
 *
 * Three responsibilities:
 *
 *   1. getRecommendationActions(orgId) / overlayRecommendationActions(orgId, recs)
 *      Fetch persisted lifecycle rows keyed by rec_id, and merge them onto a
 *      freshly computed Recommendation[]. TWO call sites need this — the
 *      server-rendered /dashboard/engine page AND GET /api/engine/recommendations
 *      both recompute Recommendation[] fresh from Tinybird on every load (it
 *      otherwise has no memory of its own — every read starts every
 *      recommendation back at a blank 'new', see the migration's header
 *      comment) — so the merge is centralised here rather than duplicated.
 *
 *   2. upsertRecommendationAction() / recordValidationResult()
 *      The single write path for every lifecycle transition. Manual status
 *      edits, auto-staging after validation, one-click activation, rollback
 *      and rejection all flow through upsertRecommendationAction so that
 *      lifecycle timestamps and cache invalidation stay consistent in one
 *      place rather than being duplicated per route.
 *
 *   3. getActiveModelSubstitution(orgId, model, feature)
 *      The hot gateway-path lookup: "should this request's model be swapped
 *      for an applied recommendation?" In-memory cached (mirrors
 *      getOrgCacheConfig in gateway/cache.ts and resolveTeamId in
 *      gateway/team-resolver.ts) — fast, fails open, never blocks a request.
 */
import { createAdminClient } from "@/lib/supabase/server";
import { redis } from "@/lib/upstash/redis";
import type {
  RecommendationAction,
  RecommendationStatus,
  ValidationResult,
} from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const TABLE = "recommendation_actions";

// ── Auto-stage thresholds — the "staged auto-apply with confirmation" gate ──
//
// A validation run that clears BOTH bars is strong enough evidence to
// self-promote validated -> staged (which surfaces a one-click "Activate" in
// the UI) without waiting on a human to manually flip status. Falling short
// of either bar leaves the recommendation at 'validated' — still useful, just
// not pre-staged. This is the literal implementation of the chosen workflow:
// "Prism stages the change and surfaces a one-click activate — human still
// pulls the trigger, but Prism does the config work and shows the evidence
// inline." See recordValidationResult().
export const STAGE_SCORE_THRESHOLD = 0.9;   // ValidationResult.overall_score must clear this
export const STAGE_MAX_EDGE_RATE   = 0.10;  // edge_cases / n_samples must stay at/under this

// ── In-memory caches ──────────────────────────────────────────────────────────
// Both mirror the Map+TTL pattern already proven in gateway/cache.ts
// (getOrgCacheConfig) and gateway/team-resolver.ts (resolveTeamId): a warm
// Lambda/Edge instance answers repeat lookups for free, and a short TTL
// bounds staleness without needing precise cross-instance invalidation.

const ACTIONS_CACHE = new Map<string, { rows: Map<string, RecommendationAction>; expiresAt: number }>();
const ACTIONS_CACHE_TTL_MS = 15_000; // 15s — dashboard-facing; can afford to be fresh

interface SubstitutionCacheEntry { sub: ActiveSubstitution | null; expiresAt: number }
const SUBSTITUTION_CACHE = new Map<string, SubstitutionCacheEntry>();
const SUBSTITUTION_CACHE_TTL_MS = 30_000; // 30s — bounds staleness after a human clicks Activate / Roll back

function substitutionKey(orgId: string, model: string, feature: string): string {
  return `${orgId}:${model}:${feature || "*"}`;
}

function redisSubKey(orgId: string): string {
  return `sub:org:${orgId}`;
}

function redisSubField(model: string, feature: string): string {
  return `${model}:${feature || "*"}`;
}

function rowFromDb(raw: Record<string, unknown>): RecommendationAction {
  return {
    rec_id:            String(raw.rec_id ?? ""),
    rec_type:          String(raw.rec_type ?? ""),
    status:            (raw.status as RecommendationStatus) ?? "new",
    current_model:     (raw.current_model as string | null)   ?? null,
    suggested_model:   (raw.suggested_model as string | null) ?? null,
    feature:           (raw.feature as string | null)         ?? null,
    validation_score:  raw.validation_score == null ? null : Number(raw.validation_score),
    validation_result: (raw.validation_result as ValidationResult | null) ?? null,
    staged_at:         (raw.staged_at  as string | null) ?? null,
    applied_at:        (raw.applied_at as string | null) ?? null,
    applied_by:        (raw.applied_by as string | null) ?? null,
    rejected_at:       (raw.rejected_at as string | null) ?? null,
    updated_at:        String(raw.updated_at ?? new Date().toISOString()),
  };
}

/**
 * Fetch every persisted lifecycle row for an org, keyed by rec_id.
 * GET /api/engine/recommendations overlays this onto the Recommendation[] it
 * recomputes from Tinybird so status/evidence survives reloads. Cached
 * in-memory for ACTIONS_CACHE_TTL_MS; fails open to an empty map so a DB
 * hiccup degrades to "nothing persisted yet" rather than breaking the page.
 */
export async function getRecommendationActions(orgId: string): Promise<Map<string, RecommendationAction>> {
  const now = Date.now();
  const hit = ACTIONS_CACHE.get(orgId);
  if (hit && hit.expiresAt > now) return hit.rows;

  try {
    const admin = createAdminClient() as SupabaseClient<Database>;
    const { data } = await admin
      .from(TABLE)
      .select("*")
      .eq("org_id", orgId) as { data: Record<string, unknown>[] | null };

    const rows = new Map<string, RecommendationAction>();
    for (const raw of data ?? []) rows.set(String(raw.rec_id), rowFromDb(raw));

    ACTIONS_CACHE.set(orgId, { rows, expiresAt: now + ACTIONS_CACHE_TTL_MS });
    return rows;
  } catch {
    return new Map();
  }
}

/**
 * Lightweight evidence/lifecycle fields merged onto a computed Recommendation
 * by overlayRecommendationActions(). Deliberately excludes the full
 * ValidationResult (its `samples` array can run ~20 entries deep) to keep
 * dashboard payloads light — `validation_summary` carries just enough
 * (score / sample count / edge-case count / when) to render an inline
 * "✓ 94% validated · 1/20 edge cases" badge. The full result is already shown
 * inline the moment a run completes, via ValidationPanel's onValidated.
 */
export interface RecommendationEvidence {
  validation_score:   number | null;
  validation_summary: { overall_score: number; n_samples: number; edge_cases: number; ran_at: string } | null;
  staged_at:          string | null;
  applied_at:         string | null;
  applied_by:         string | null;
  rejected_at:        string | null;
}

/**
 * Merge persisted recommendation_actions rows onto a freshly computed
 * Recommendation[] — the one piece of glue both /dashboard/engine (the server
 * page) and GET /api/engine/recommendations need so the dashboard can render
 * real, persisted lifecycle state (status survives reloads; staged/applied
 * recommendations carry their evidence trail and a working
 * Activate / Roll back / Reject) instead of every recomputed list starting
 * over at a blank 'new'.
 *
 * `status` is overridden wholesale when a persisted row exists — every
 * freshly built Recommendation starts at 'new' (buildRecommendations has no
 * memory of its own), so the persisted status, when present, is always the
 * *true* current one. Recommendations with no persisted row yet (never
 * validated) pass through unchanged plus a block of `null` evidence fields.
 */
export async function overlayRecommendationActions<T extends { id: string; status: RecommendationStatus }>(
  orgId:           string,
  recommendations: readonly T[],
): Promise<(T & RecommendationEvidence)[]> {
  const persistedActions = await getRecommendationActions(orgId);

  return recommendations.map(r => {
    const persisted = persistedActions.get(r.id);
    const evidence  = persisted?.validation_result ?? null;
    return {
      ...r,
      status: persisted?.status ?? r.status,
      validation_score:   persisted?.validation_score ?? null,
      validation_summary: evidence ? {
        overall_score: evidence.overall_score,
        n_samples:     evidence.n_samples,
        edge_cases:    evidence.edge_cases,
        ran_at:        evidence.ran_at,
      } : null,
      staged_at:   persisted?.staged_at   ?? null,
      applied_at:  persisted?.applied_at  ?? null,
      applied_by:  persisted?.applied_by  ?? null,
      rejected_at: persisted?.rejected_at ?? null,
    };
  });
}

/**
 * Drop cached state for an org after a write. The substitution cache is
 * scanned and pruned by orgId prefix (not just the (model, feature) pair that
 * changed) — an org-wide row (feature IS NULL) can affect requests cached
 * under many different feature-tag keys, and this map only ever holds one
 * entry per (org, model, feature) triple actually seen on the gateway, so a
 * linear scan on this rare write path is cheap.
 */
function invalidateCaches(orgId: string): void {
  ACTIONS_CACHE.delete(orgId);
  // Array.from(...) — not a bare `for...of` over the iterator — matches the
  // established pattern elsewhere (e.g. lib/billing/sync.ts) and sidesteps
  // the `--downlevelIteration`-required MapIterator restriction under this
  // project's compiler target.
  for (const key of Array.from(SUBSTITUTION_CACHE.keys())) {
    if (key.startsWith(`${orgId}:`)) SUBSTITUTION_CACHE.delete(key);
  }
  void redis.del(redisSubKey(orgId)).catch(() => {});
}

/**
 * Minimal recommendation shape needed to persist or evaluate a lifecycle
 * transition — deliberately NOT `Pick<Recommendation, ...>`. Two call shapes
 * need to satisfy this:
 *
 *   - The validate routes receive `recId`/`recType`/`recTitle` as plain
 *     strings out of a client JSON body (and, for the real-sample path, back
 *     out of a Redis job blob). `Recommendation.type` is a narrow
 *     string-literal union (RecommendationType) — forcing callers to satisfy
 *     it would mean either an unsafe cast at the JSON boundary or threading
 *     the union type through Zod, Redis serialisation, and SSE payloads for
 *     no real benefit.
 *   - The activate/rollback/reject endpoint rebuilds this shape from a
 *     previously *persisted* recommendation_actions row (which itself stores
 *     rec_type as `text`), not a freshly recomputed Recommendation.
 *
 * Both line up naturally with this wider, looser, structurally-typed contract.
 */
export interface RecommendationRef {
  id:               string;
  type:             string;
  title:            string;
  current_model?:   string | null;
  suggested_model?: string | null;
  feature?:         string | null;
}

export interface UpsertActionInput {
  orgId:             string;
  rec:               RecommendationRef;
  status:            RecommendationStatus;
  validationScore?:  number | null;
  validationResult?: ValidationResult | null;
  appliedBy?:        string | null;
}

/**
 * Single write path for every recommendation lifecycle transition (stage,
 * activate, reject, roll back, or a plain manual status edit). Upserts on
 * (org_id, rec_id) — Recommendation.id is a deterministic hash of
 * type+model+feature, so the same logical recommendation always lands on the
 * same row even though Recommendation[] itself is recomputed fresh on every
 * GET from Tinybird.
 *
 * Stamps the lifecycle timestamp that matches the *target* status and clears
 * the others, so a staged -> rejected -> validated -> staged replay can't
 * leave a stale rejected_at sitting next to a fresh staged_at.
 */
export async function upsertRecommendationAction(input: UpsertActionInput): Promise<RecommendationAction | null> {
  const { orgId, rec, status } = input;
  const nowIso = new Date().toISOString();

  const patch: Record<string, unknown> = {
    org_id:          orgId,
    rec_id:          rec.id,
    rec_type:        rec.type,
    title:           rec.title ?? null,
    status,
    current_model:   rec.current_model   ?? null,
    suggested_model: rec.suggested_model ?? null,
    feature:         rec.feature         ?? null,
    staged_at:       status === "staged"   ? nowIso : null,
    applied_at:      status === "applied"  ? nowIso : null,
    applied_by:      status === "applied"  ? (input.appliedBy ?? null) : null,
    rejected_at:     status === "rejected" ? nowIso : null,
  };

  if (input.validationScore  !== undefined) patch.validation_score  = input.validationScore;
  if (input.validationResult !== undefined) patch.validation_result = input.validationResult;

  try {
    const admin = createAdminClient() as SupabaseClient<Database>;
    const { data, error } = await admin
      .from(TABLE)
      .upsert(patch as Database["public"]["Tables"]["recommendation_actions"]["Insert"], { onConflict: "org_id,rec_id" })
      .select("*")
      .single() as { data: Record<string, unknown> | null; error: unknown };

    if (error || !data) return null;

    invalidateCaches(orgId);
    return rowFromDb(data);
  } catch {
    return null;
  }
}

/**
 * Auto-stage hook — call this immediately after a validation run completes.
 * Persists the evidence trail and promotes validated -> staged when BOTH
 * confidence bars clear (see STAGE_SCORE_THRESHOLD / STAGE_MAX_EDGE_RATE);
 * otherwise the evidence is still recorded but status stays at 'validated'
 * (a human can still stage/apply manually from the dashboard).
 *
 * Defensive guard: a validation re-run must never silently move a
 * recommendation off 'applied' or 'rejected' — those are terminal, deliberate
 * human decisions (made via the activate/rollback/reject endpoints) and the
 * only thing that may revise them is another explicit human action. This
 * function only ever participates in the 'new' -> 'testing' -> 'validated'
 * <-> 'staged' auto-assessment loop.
 */
export async function recordValidationResult(
  orgId:    string,
  rec:      RecommendationRef,
  result:   ValidationResult,
  traceId?: string,
): Promise<RecommendationAction | null> {
  const existing = (await getRecommendationActions(orgId)).get(rec.id) ?? null;
  if (existing?.status === "applied" || existing?.status === "rejected") return existing;

  // Trace-linked durable record of this validation run: lets the Trace Engine
  // surface the validation on the trace detail (joined by trace_id) and link it
  // back to its recommendation (rec_id) — closing the trace⇄eval⇄rec graph.
  // Only when a trace context was threaded through the run; fails open so the
  // recommendation-side persistence below is never blocked by the mirror write.
  if (traceId) {
    try {
      const admin = createAdminClient() as SupabaseClient<Database>;
      await admin.from("evaluation_runs").insert({
        org_id:        orgId,
        rec_id:        rec.id,
        trace_id:      traceId,
        mode:          result.mode,
        status:        "done",
        n_samples:     result.n_samples,
        edge_cases:    result.edge_cases,
        overall_score: result.overall_score,
        current_model: result.current_model,
        target_model:  result.target_model,
        samples:       result.samples,
        started_at:    result.ran_at,
        completed_at:  new Date().toISOString(),
      } as unknown as Database["public"]["Tables"]["evaluation_runs"]["Insert"]);
    } catch { /* fail open — never block validation persistence on the eval-run mirror */ }
  }

  const edgeRate  = result.n_samples > 0 ? result.edge_cases / result.n_samples : 1;
  const qualifies = result.overall_score >= STAGE_SCORE_THRESHOLD
                 && edgeRate <= STAGE_MAX_EDGE_RATE
                 && !!rec.current_model
                 && !!rec.suggested_model;

  return upsertRecommendationAction({
    orgId,
    rec,
    status:           qualifies ? "staged" : "validated",
    validationScore:  result.overall_score,
    validationResult: result,
  });
}

/**
 * Called when an evaluation run finishes. Persists the run result to
 * evaluation_runs, then delegates to recordValidationResult() which owns
 * the auto-stage logic (STAGE_SCORE_THRESHOLD / STAGE_MAX_EDGE_RATE).
 *
 * Does NOT own the state-machine guard ("never move off applied/rejected") —
 * that guard lives in recordValidationResult(), so both code paths stay in sync.
 */
export async function recordValidationFromEval(
  orgId:  string,
  recId:  string,
  runId:  string,
  result: ValidationResult,
): Promise<void> {
  const admin = createAdminClient();

  // Update the evaluation run row with the completed result
  await admin
    .from("evaluation_runs")
    .update({
      status:        "done",
      overall_score: result.overall_score,
      n_samples:     result.n_samples,
      edge_cases:    result.edge_cases,
      samples:       result.samples,
      current_model: result.current_model,
      target_model:  result.target_model,
      completed_at:  new Date().toISOString(),
    } as unknown as Database["public"]["Tables"]["evaluation_runs"]["Update"])
    .eq("id", runId)
    .eq("org_id", orgId);

  // Fetch the persisted rec row to rebuild the RecommendationRef shape
  // needed by recordValidationResult (which owns the auto-stage decision).
  const actions = await getRecommendationActions(orgId);
  const existing = actions.get(recId);

  if (!existing) return; // recommendation was deleted — nothing to update

  const ref: RecommendationRef = {
    id:              existing.rec_id,
    type:            existing.rec_type,
    title:           "",  // not stored in recommendation_actions; safe to omit for scoring
    current_model:   existing.current_model,
    suggested_model: existing.suggested_model,
    feature:         existing.feature,
  };

  await recordValidationResult(orgId, ref, result);
}

// ── Gateway hot-path lookup ───────────────────────────────────────────────────

export interface ActiveSubstitution {
  rec_id:          string;
  current_model:   string;
  suggested_model: string;
  feature:         string | null;
}

/**
 * Is there an applied model-swap recommendation that should redirect this
 * request's model? Called once per gateway request, right after the
 * requested model is known and before the upstream fetch — see the
 * "Recommendation-driven model substitution" block in route.ts, which mirrors
 * the existing soft-cap-model-downgrade mechanism (replace `model` in the
 * parsed body; stamp `tags['model_downgraded_from']` and
 * `tags['recommendation_id']` for observability — narrow, proven, reversible).
 *
 * Resolution order when both exist for the same model: a feature-scoped row
 * (more specific — only matches requests tagged tags['feature'] = <feature>)
 * wins over an org-wide row (feature IS NULL — matches every request for that
 * model). In-memory cached for SUBSTITUTION_CACHE_TTL_MS; always fails open —
 * returns null (no substitution; request proceeds untouched) on any error.
 */
export async function getActiveModelSubstitution(
  orgId:   string,
  model:   string,
  feature: string,
): Promise<ActiveSubstitution | null> {
  if (!orgId || !model) return null;

  const key = substitutionKey(orgId, model, feature);
  const now = Date.now();
  const hit = SUBSTITUTION_CACHE.get(key);
  if (hit && hit.expiresAt > now) return hit.sub;

  // Check Redis write-through cache before hitting Supabase.
  // "null" string = negative cache entry (no applied substitution for this key).
  try {
    const redisField = redisSubField(model, feature);
    const cached = await redis.hget<string>(redisSubKey(orgId), redisField);
    if (cached !== null && cached !== undefined) {
      const sub: ActiveSubstitution | null = cached === "null" ? null : JSON.parse(cached) as ActiveSubstitution;
      SUBSTITUTION_CACHE.set(key, { sub, expiresAt: now + SUBSTITUTION_CACHE_TTL_MS });
      return sub;
    }
  } catch { /* Redis unavailable — fall through to Supabase */ }

  try {
    const admin = createAdminClient() as SupabaseClient<Database>;
    // The partial index recommendation_actions_active_substitution
    // (org_id, current_model) WHERE status = 'applied' keeps this result set
    // to a handful of rows at most — resolving the best match in JS sidesteps
    // any PostgREST .or() filter-string escaping concerns for arbitrary
    // caller-supplied feature tag values.
    const { data } = await admin
      .from(TABLE)
      .select("rec_id, current_model, suggested_model, feature")
      .eq("org_id", orgId)
      .eq("status", "applied")
      .eq("current_model", model) as { data: ActiveSubstitution[] | null };

    const rows = data ?? [];
    const sub  = rows.find(r => r.feature && r.feature === feature)
              ?? rows.find(r => !r.feature)
              ?? null;

    SUBSTITUTION_CACHE.set(key, { sub, expiresAt: now + SUBSTITUTION_CACHE_TTL_MS });

    // Write back to Redis so subsequent cold-start invocations skip Supabase.
    const redisField = redisSubField(model, feature);
    void redis.hset(redisSubKey(orgId), { [redisField]: sub === null ? "null" : JSON.stringify(sub) })
      .then(() => redis.expire(redisSubKey(orgId), 60))
      .catch(() => {});

    return sub;
  } catch {
    return null; // fail open — never block the gateway on a recommendation lookup
  }
}
