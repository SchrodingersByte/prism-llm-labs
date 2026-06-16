/**
 * /api/annotations/queue (PRD-3)
 *
 * GET  — list the org's annotation queue, prioritized (priority DESC, newest
 *        first). Filter by ?status= and ?reason=. Session-authed (org member).
 * POST — manually enqueue a trace/span for human review ("send to queue").
 *        canWriteOrg. De-duped against open items via the partial unique index.
 *
 * The queue is also auto-populated by the PRD-1 sampler cron (edge cases);
 * see app/api/cron/run-online-evals/route.ts.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

const VALID_STATUS = ["pending", "in_review", "done", "skipped"] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url    = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const reason = url.searchParams.get("reason") ?? undefined;
  const limit  = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  const offset = Number(url.searchParams.get("offset") ?? 0);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (admin as any)
    .from("annotation_queue")
    .select("id, project_id, trace_id, span_id, session_id, eval_run_id, status, priority, reason, assignee, created_at, updated_at", { count: "exact" })
    .eq("org_id", member.org_id)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (status && (VALID_STATUS as readonly string[]).includes(status)) q = q.eq("status", status);
  if (reason) q = q.eq("reason", reason);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
  return NextResponse.json({ items: data ?? [], total: count ?? 0, limit, offset });
}

const EnqueueSchema = z.object({
  trace_id:    z.string().min(1).max(200),
  span_id:     z.string().max(200).optional(),
  session_id:  z.string().max(200).optional(),
  eval_run_id: z.string().uuid().optional(),
  project_id:  z.string().uuid().optional(),
  reason:      z.string().max(50).default("manual"),
  priority:    z.number().int().min(0).max(100).default(0),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot manage the queue" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = EnqueueSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  const e = parsed.data;

  const admin = createAdminClient();
  // De-dupe: skip if there's already an open item for this (trace, span).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dup = (admin as any)
    .from("annotation_queue")
    .select("id")
    .eq("org_id", member.org_id)
    .eq("trace_id", e.trace_id)
    .in("status", ["pending", "in_review"]);
  dup = e.span_id ? dup.eq("span_id", e.span_id) : dup.is("span_id", null);
  const { data: existing } = await dup.maybeSingle();
  if (existing) return NextResponse.json({ id: existing.id, deduped: true });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("annotation_queue")
    .insert({
      org_id:      member.org_id,
      project_id:  e.project_id  ?? null,
      trace_id:    e.trace_id,
      span_id:     e.span_id     ?? null,
      session_id:  e.session_id  ?? null,
      eval_run_id: e.eval_run_id ?? null,
      reason:      e.reason,
      priority:    e.priority,
    })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Failed to enqueue" }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
