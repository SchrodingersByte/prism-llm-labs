/**
 * /api/feedback (PRD-3)
 *
 * POST — end-user feedback ingest (thumbs / score / comment) linked to a
 *        trace/span/session. Key-authed (Bearer Prism API key) + rate-limited,
 *        single-or-batch envelope — clones the /api/outcomes pattern. Comments
 *        are PII-masked before storage (PRD-3 risk: PII in comments).
 *
 * GET  — session-authed read for the dashboard:
 *          ?trace_id=…  → raw feedback rows for that trace (trace-detail widget)
 *          default      → thumbs aggregation grouped by feature_tag (Product view)
 *
 * Reviewer/human review scores do NOT go here — they land in eval_scores
 * (scorer_type='human') via /api/annotations/queue/[id]. This table is end-user
 * signal only.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { authenticateIngestKey } from "@/lib/ingest/auth";
import { maskPii } from "@/lib/privacy/pii-masker";

export const runtime = "nodejs";

const FeedbackSchema = z.object({
  value:       z.number(),                         // thumbs 1/0 or a 0..1 score
  trace_id:    z.string().max(200).optional(),
  span_id:     z.string().max(200).optional(),
  session_id:  z.string().max(200).optional(),
  feature_tag: z.string().max(100).optional(),
  comment:     z.string().max(4000).optional(),
  source:      z.enum(["end_user", "reviewer"]).default("end_user"),
  project_id:  z.string().uuid().optional(),
});
const BatchSchema = z.object({ events: z.array(FeedbackSchema).min(1).max(500) });

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("authorization") ?? "";
  const auth = await authenticateIngestKey(authHeader);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Single event or { events: [...] } envelope (mirrors /api/outcomes).
  const normalised = (body as Record<string, unknown>)?.events ? body : { events: [body] };
  const parsed = BatchSchema.safeParse(normalised);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const orgId = auth.key.org_id;
  const rows = parsed.data.events.map(e => ({
    org_id:      orgId,
    api_key_id:  auth.key.id,
    project_id:  e.project_id ?? auth.key.project_id ?? null,
    source:      e.source,
    feature_tag: e.feature_tag ?? null,
    trace_id:    e.trace_id   ?? null,
    span_id:     e.span_id    ?? null,
    session_id:  e.session_id ?? null,
    value:       e.value,
    comment:     e.comment ? maskPii(e.comment) : null,
  }));

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from("feedback").insert(rows);
  if (error) return NextResponse.json({ error: "Failed to record feedback" }, { status: 500 });

  return NextResponse.json({ ok: true, recorded: rows.length }, { status: 201 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url     = new URL(req.url);
  const traceId = url.searchParams.get("trace_id") ?? undefined;
  const admin   = createAdminClient();

  // Raw rows for one trace (trace-detail feedback widget).
  if (traceId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (admin as any)
      .from("feedback")
      .select("id, source, feature_tag, span_id, value, comment, created_at")
      .eq("org_id", member.org_id)
      .eq("trace_id", traceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });
    return NextResponse.json({ feedback: data ?? [] });
  }

  // Default: thumbs aggregation by feature (last 30d), for the Product view.
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("feedback")
    .select("feature_tag, value")
    .eq("org_id", member.org_id)
    .not("value", "is", null)
    .gte("created_at", since)
    .limit(50000);
  if (error) return NextResponse.json({ error: "Failed to fetch feedback" }, { status: 500 });

  const groups = new Map<string, { up: number; down: number; sum: number; n: number }>();
  for (const r of (data ?? []) as { feature_tag: string | null; value: number }[]) {
    const key = r.feature_tag ?? "(untagged)";
    if (!groups.has(key)) groups.set(key, { up: 0, down: 0, sum: 0, n: 0 });
    const g = groups.get(key)!;
    g.n++; g.sum += Number(r.value);
    if (Number(r.value) >= 0.5) g.up++; else g.down++;
  }
  const aggregation = Array.from(groups.entries()).map(([feature_tag, g]) => ({
    feature_tag,
    count:        g.n,
    thumbs_up:    g.up,
    thumbs_down:  g.down,
    up_rate:      Math.round((g.up / g.n) * 10000) / 10000,
    avg_value:    Math.round((g.sum / g.n) * 10000) / 10000,
  })).sort((a, b) => b.count - a.count);

  return NextResponse.json({ aggregation });
}
