/**
 * /api/annotations/queue/[id] (PRD-3)
 *
 * PUT — act on a queue item. canWriteOrg (read_only blocked).
 *   { action: "claim" }                          → status in_review, assignee = me
 *   { action: "skip" }                           → status skipped
 *   { action: "submit", score, passed?, comment?, model?, span_id? }
 *        → writes a human row to eval_scores (scorer_type='human') AND marks the
 *          item done. This is the loop-closing write: human labels in eval_scores
 *          feed PRD-1's judge↔human agreement. Span-level annotation = pass span_id.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";
import { maskPii } from "@/lib/privacy/pii-masker";

export const runtime = "nodejs";

const ActionSchema = z.object({
  action:  z.enum(["claim", "submit", "skip"]),
  score:   z.number().min(0).max(1).optional(),
  passed:  z.boolean().optional(),
  comment: z.string().max(4000).optional(),
  model:   z.string().max(100).optional(),
  span_id: z.string().max(200).optional(),     // annotate a specific span (overrides the item's span)
});

const PASS_THRESHOLD = 0.7;

export async function PUT(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot review" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  const { action, score, passed, comment, model, span_id } = parsed.data;

  const admin = createAdminClient();
  // Load the item (org-scoped) — gives us trace_id/span_id/eval_run_id to attach the score to.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (admin as any)
    .from("annotation_queue")
    .select("id, trace_id, span_id, eval_run_id, status")
    .eq("id", params.id)
    .eq("org_id", member.org_id)
    .maybeSingle();
  if (!item) return NextResponse.json({ error: "Queue item not found" }, { status: 404 });

  if (action === "claim") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("annotation_queue")
      .update({ status: "in_review", assignee: user.id })
      .eq("id", params.id).eq("org_id", member.org_id);
    if (error) return NextResponse.json({ error: "Failed to claim" }, { status: 500 });
    return NextResponse.json({ ok: true, status: "in_review" });
  }

  if (action === "skip") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from("annotation_queue")
      .update({ status: "skipped" })
      .eq("id", params.id).eq("org_id", member.org_id);
    if (error) return NextResponse.json({ error: "Failed to skip" }, { status: 500 });
    return NextResponse.json({ ok: true, status: "skipped" });
  }

  // action === "submit"
  if (score == null) return NextResponse.json({ error: "submit requires a score (0..1)" }, { status: 422 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: scoreErr } = await (admin as any).from("eval_scores").insert({
    org_id:      member.org_id,
    eval_run_id: item.eval_run_id ?? null,
    scorer_type: "human",
    model:       model ?? null,
    judge_model: null,
    score,
    passed:      passed ?? score >= PASS_THRESHOLD,
    reason:      comment ? maskPii(comment) : null,
    trace_id:    item.trace_id ?? null,
    span_id:     span_id ?? item.span_id ?? null,
  });
  if (scoreErr) return NextResponse.json({ error: "Failed to record human score" }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updErr } = await (admin as any)
    .from("annotation_queue")
    .update({ status: "done", assignee: user.id })
    .eq("id", params.id).eq("org_id", member.org_id);
  if (updErr) return NextResponse.json({ error: "Scored, but failed to close item" }, { status: 500 });

  return NextResponse.json({ ok: true, status: "done" });
}
