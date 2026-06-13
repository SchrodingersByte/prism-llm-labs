/**
 * PATCH /api/engine/recommendations/[id]
 *
 * Drives the human-confirmation step of the "staged auto-apply with
 * confirmation" workflow — the only way a recommendation's lifecycle can move
 * into or out of the terminal 'applied' / 'rejected' states. (See
 * recordValidationResult()'s defensive guard in lib/engine/actions.ts, which
 * refuses to let an automatic re-validation silently override either one —
 * these four verbs are the *sole* authorised path to do so.)
 *
 * Body: { action: "activate" | "rollback" | "reject" | "reconsider" }
 *
 *   activate    staged   -> applied    Turns ON real gateway model substitution
 *                                      (see getActiveModelSubstitution). Only
 *                                      fires from 'staged' — i.e. only once a
 *                                      validation run has cleared the confidence
 *                                      bar — so every applied substitution always
 *                                      has an evidence trail behind it. Idempotent
 *                                      from 'applied' (re-confirm is a no-op).
 *   rollback    applied  -> validated  Turns OFF substitution; demotes rather
 *                                      than deletes, so the evidence trail (and
 *                                      the one-click path back to 'staged' via
 *                                      re-validation) survives.
 *   reject      *        -> rejected   Dismiss. Disallowed directly from
 *                                      'applied' — roll back first, so "turn off
 *                                      a live, spend-affecting substitution" can
 *                                      never be a side effect of a different verb.
 *                                      Idempotent from 'rejected'.
 *   reconsider  rejected -> validated  Reopens a dismissed recommendation —
 *                                      symmetric to rollback, and for the same
 *                                      reason: demotes to 'validated' rather
 *                                      than deleting the row, so the evidence
 *                                      trail survives and a fresh validation
 *                                      run can naturally re-stage it (or not)
 *                                      on its own merits. This is *the* explicit
 *                                      human action recordValidationResult()'s
 *                                      guard is written in anticipation of — its
 *                                      doc comment promises a rejected
 *                                      recommendation moves only "via another
 *                                      explicit human action"; without this verb
 *                                      that promise had no door behind it, and
 *                                      'rejected' was a one-way trap. Disallowed
 *                                      from any state but 'rejected' (409
 *                                      not_rejected — a state conflict, not a
 *                                      malformed request, hence not a 400).
 *
 * Deliberately NOT building: a manual "stage" action. Staging is evidence-gated
 * and auto-only (see STAGE_SCORE_THRESHOLD/STAGE_MAX_EDGE_RATE) — letting a
 * human shortcut straight to 'staged' would hand an unvalidated recommendation
 * the same one-click-Activate affordance as a validated one, quietly breaking
 * the "every applied substitution has an evidence trail" guarantee that
 * 'activate' above is built to depend on.
 *
 * [id] == Recommendation.id == recommendation_actions.rec_id (a deterministic
 * hash of type+model+feature). A row is guaranteed to exist by the time a
 * human can act on any of these four verbs — recordValidationResult() creates
 * it the moment the *first* validation run scores this recommendation — so we
 * read the persisted row back (current_model/suggested_model/feature/rec_type/
 * title/evidence) rather than recomputing Recommendation[] fresh from
 * Tinybird, which would be slower and could in principle drift from the exact
 * pair that was actually validated.
 *
 * Mirrors the PATCH /api/model-governance/requests/[id] precedent: auth check
 * → feature gate → Zod body → state-checked admin-client update → audit log.
 * Restricted to owners — the same bar set for budgets/provider-keys/alerts/
 * billing, and at least as consequential: 'activate' flips on real,
 * spend-affecting enforcement on the live gateway request path.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { createAdminClient } from "@/lib/supabase/server";
import { upsertRecommendationAction, type RecommendationRef } from "@/lib/engine/actions";
import { writeAuditLog } from "@/lib/audit/log";
import type { RecommendationStatus, ValidationResult } from "@/lib/engine/types";
import { z } from "zod";

const TABLE = "recommendation_actions";

const ActionSchema = z.object({
  action: z.enum(["activate", "rollback", "reject", "reconsider"]),
});

const AUDIT_ACTION = {
  activate:   "recommendation.activated",
  rollback:   "recommendation.rolled_back",
  reject:     "recommendation.rejected",
  reconsider: "recommendation.reconsidered",
} as const;

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "engine");
  if (guard) return guard;

  const body = ActionSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { action } = body.data;

  // Read the persisted row directly — bypassing the 15s ACTIONS_CACHE in
  // lib/engine/actions.ts. This is a rare, human-triggered, correctness-
  // critical write: a cross-instance stale cache read could wrongly 409 the
  // very first click after a validation run stages the recommendation, which
  // is the UI's primary path ("validate, watch it pass, click Activate").
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from(TABLE)
    .select("*")
    .eq("org_id", ctx.orgId)
    .eq("rec_id", params.id)
    .maybeSingle() as { data: Record<string, unknown> | null };

  if (!row) {
    return NextResponse.json({
      error:   "not_found",
      message: "No evidence on file for this recommendation yet — run a validation first.",
    }, { status: 404 });
  }

  const current = (row.status as RecommendationStatus) ?? "new";
  let nextStatus: RecommendationStatus;

  switch (action) {
    case "activate":
      if (current === "applied") return NextResponse.json({ data: row }); // idempotent re-confirm
      if (current !== "staged") {
        return NextResponse.json({
          error:   "not_staged",
          message: "Only staged recommendations can be activated. Run validation until it clears the confidence bar (≥90% agreement, <10% edge cases) — Prism stages it automatically once it does.",
        }, { status: 409 });
      }
      nextStatus = "applied";
      break;

    case "rollback":
      if (current !== "applied") {
        return NextResponse.json({
          error:   "not_applied",
          message: "Only an actively applied recommendation can be rolled back.",
        }, { status: 409 });
      }
      nextStatus = "validated";
      break;

    case "reject":
      if (current === "rejected") return NextResponse.json({ data: row }); // idempotent
      if (current === "applied") {
        return NextResponse.json({
          error:   "rollback_required",
          message: "This recommendation is actively applied — roll it back first, so turning off a live substitution is never a side effect of rejecting it.",
        }, { status: 409 });
      }
      nextStatus = "rejected";
      break;

    case "reconsider":
      if (current !== "rejected") {
        return NextResponse.json({
          error:   "not_rejected",
          message: "Only a rejected recommendation can be reconsidered.",
        }, { status: 409 });
      }
      // Lands at 'validated', not 'staged' — mirrors rollback. Reopening isn't
      // re-endorsing: the evidence that justified the original rejection (or
      // went stale since) still deserves a fresh validation run before this
      // earns a one-click Activate again. recordValidationResult() will
      // re-stage it on its own if a new run clears the confidence bar.
      nextStatus = "validated";
      break;
  }

  const rec: RecommendationRef = {
    id:              String(row.rec_id   ?? ""),
    type:            String(row.rec_type ?? ""),
    title:           (row.title as string | null) ?? "",
    current_model:   (row.current_model   as string | null) ?? null,
    suggested_model: (row.suggested_model as string | null) ?? null,
    feature:         (row.feature         as string | null) ?? null,
  };

  const updated = await upsertRecommendationAction({
    orgId:  ctx.orgId,
    rec,
    status: nextStatus,
    appliedBy: nextStatus === "applied" ? ctx.user.id : undefined,
    // None of these three transitions re-run validation — each acts on
    // whatever evidence is already on file — so carry it through verbatim.
    // (upsertRecommendationAction only writes validation_score/_result when
    // explicitly given a value, but since upsert replaces the row wholesale,
    // passing the *current* values through is what makes this a true "carry
    // forward" rather than relying on column-omission semantics we'd rather
    // not depend on.)
    validationScore:  row.validation_score == null ? null : Number(row.validation_score),
    validationResult: (row.validation_result as ValidationResult | null) ?? null,
  });

  if (!updated) {
    return NextResponse.json({ error: "Failed to update recommendation" }, { status: 500 });
  }

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action:      AUDIT_ACTION[action],
    targetType:  "recommendation_action",
    targetId:    params.id,
    metadata: {
      from: current, to: nextStatus,
      rec_type: rec.type, current_model: rec.current_model, suggested_model: rec.suggested_model, feature: rec.feature,
    },
  });

  return NextResponse.json({ data: updated });
}
