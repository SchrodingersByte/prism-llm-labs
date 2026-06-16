/**
 * Cron: online evaluation sampler (PRD-1).
 *
 * For each enabled eval_config, pulls recent captured content (request_logs,
 * PRD-0) in scope, samples it, runs the configured judge scorers, and writes
 * results to eval_scores. Judge cost is bounded by the per-config sampling rate
 * + a hard per-run cap.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { SCORERS, isScorerType, type ScorerInput, type ScorerType } from "@/lib/eval/judges";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { v4 as uuidv4 } from "uuid";

export const runtime     = "nodejs";
export const maxDuration = 300;

const WINDOW_HOURS = 24;   // look-back window for production content
const FETCH_CAP    = 500;  // rows pulled per config
const SCORE_CAP    = 25;   // max rows scored per config per run (judge cost guard)

function extractQuestion(prompt: unknown): string {
  if (typeof prompt === "string") return prompt;
  if (Array.isArray(prompt)) {
    for (let k = prompt.length - 1; k >= 0; k--) {
      const m = prompt[k] as { role?: string; content?: unknown };
      if (m?.role === "user") {
        return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      }
    }
    return JSON.stringify(prompt).slice(0, 2000);
  }
  return "";
}

function contextToString(context: unknown): string | undefined {
  if (!context) return undefined;
  if (typeof context === "string") return context;
  try { return JSON.stringify(context).slice(0, 4000); } catch { return undefined; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runConfig(admin: any, cfg: any): Promise<number> {
  const since = new Date(Date.now() - WINDOW_HOURS * 3_600_000).toISOString();

  let q = admin
    .from("request_logs")
    .select("event_id, project_id, model, prompt, completion, context, trace_id, span_id")
    .eq("org_id", cfg.org_id)
    .not("completion", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(FETCH_CAP);
  if (cfg.project_id)     q = q.eq("project_id", cfg.project_id);
  if (cfg.scope?.model)   q = q.eq("model", cfg.scope.model);

  const { data: rows } = await q;
  const list = (rows ?? []) as Array<{
    project_id: string | null; model: string; prompt: unknown; completion: unknown; context: unknown;
    trace_id: string | null; span_id: string | null;
  }>;
  if (list.length === 0) return 0;

  // Uniform sample at the configured rate (stratified tiers deferred); clamp to [1, SCORE_CAP].
  const rate = Math.max(0, Math.min(1, cfg.sampling?.rate ?? 0.05));
  const n    = Math.max(1, Math.min(Math.round(list.length * rate), SCORE_CAP, list.length));
  const sample = [...list].sort(() => Math.random() - 0.5).slice(0, n);

  const scorers: ScorerType[] = (cfg.scorers ?? ["rubric"]).filter((s: string) => isScorerType(s));
  const judgeModel = cfg.judge_model || "claude-haiku-4-5";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scoreRows: any[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mirrorRows: any[] = [];   // Tinybird eval_score_events mirror (quality trends)
  const scoredAt = new Date().toISOString();
  for (const row of sample) {
    const completion = typeof row.completion === "string" ? row.completion : String(row.completion ?? "");
    if (!completion) continue;
    const input: ScorerInput = {
      judgeModel,
      prompt:     extractQuestion(row.prompt),
      completion,
      context:    contextToString(row.context),
    };
    for (const st of scorers) {
      const r = await SCORERS[st](input, cfg.rubric ?? undefined);
      if (!r) continue;
      scoreRows.push({
        org_id:      cfg.org_id,
        scorer_type: st,
        model:       row.model,
        judge_model: judgeModel,
        score:       r.score,
        passed:      r.passed,
        reason:      r.reason,
        latency_ms:  r.latency_ms ?? null,
        trace_id:    row.trace_id ?? null,
        span_id:     row.span_id ?? null,
      });
      mirrorRows.push({
        event_id:    uuidv4(),
        org_id:      cfg.org_id,
        project_id:  row.project_id ?? cfg.project_id ?? "",
        scorer_type: st,
        model:       row.model ?? "",
        judge_model: st === "exact_match" ? "" : judgeModel,
        score:       r.score,
        passed:      r.passed ? 1 : 0,
        eval_run_id: "",
        trace_id:    row.trace_id ?? "",
        span_id:     row.span_id ?? "",
        scored_at:   scoredAt,
      });
    }
  }

  if (scoreRows.length > 0) {
    await admin.from("eval_scores").insert(scoreRows);
    // P1.6: mirror to the Tinybird eval_score_events DS for the quality-trend pipes
    // (quality_timeseries / quality_by_model / quality_by_scorer). Supabase eval_scores
    // stays the source of truth; the mirror is best-effort and must never break scoring.
    try { await ingestToTinybird(mirrorRows, "eval_score_events"); } catch { /* non-fatal */ }
    // PRD-3: route edge cases to human review. Never let queue population break
    // scoring (e.g. before the annotation_queue migration is applied).
    try { await enqueueEdgeCases(admin, cfg, scoreRows); } catch { /* non-fatal */ }
  }
  return scoreRows.length;
}

/**
 * PRD-3: auto-populate the annotation queue from this run's edge cases (failed
 * scores with a trace to review). Caps at the 10 worst per config run and skips
 * traces already open in the queue, so the queue can't balloon.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enqueueEdgeCases(admin: any, cfg: any, scoreRows: any[]): Promise<void> {
  // Worst-first, one per trace, must have a trace to review.
  const seen = new Set<string>();
  const edges = scoreRows
    .filter(r => r.passed === false && r.trace_id)
    .sort((a, b) => Number(a.score) - Number(b.score))
    .filter(r => { if (seen.has(r.trace_id)) return false; seen.add(r.trace_id); return true; })
    .slice(0, 10);
  if (edges.length === 0) return;

  const traceIds = edges.map(r => r.trace_id);
  const { data: open } = await admin
    .from("annotation_queue")
    .select("trace_id")
    .eq("org_id", cfg.org_id)
    .in("trace_id", traceIds)
    .in("status", ["pending", "in_review"]);
  const alreadyOpen = new Set((open ?? []).map((o: { trace_id: string }) => o.trace_id));

  const rows = edges
    .filter(r => !alreadyOpen.has(r.trace_id))
    .map(r => ({
      org_id:     cfg.org_id,
      project_id: cfg.project_id ?? null,
      trace_id:   r.trace_id,
      span_id:    r.span_id ?? null,
      reason:     "edge",
      // Worse score → higher priority (reviewed first).
      priority:   Math.max(0, Math.round((1 - Number(r.score)) * 10)),
    }));
  if (rows.length > 0) await admin.from("annotation_queue").insert(rows);
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: configs } = await (admin as any)
    .from("eval_configs")
    .select("id, org_id, project_id, judge_model, rubric, scorers, sampling, scope")
    .eq("enabled", true);

  let scored = 0;
  const errors: string[] = [];
  for (const cfg of (configs ?? [])) {
    try {
      scored += await runConfig(admin, cfg);
    } catch (e) {
      errors.push(`${cfg.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    configs: (configs ?? []).length,
    scored,
    errors: errors.length ? errors : undefined,
  });
}
