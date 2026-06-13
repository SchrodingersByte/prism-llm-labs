import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

// ── GET /api/evaluations ──────────────────────────────────────────────────────
// Returns paginated evaluation runs for the authenticated org.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const url    = new URL(req.url);
  const limit  = Math.min(Number(url.searchParams.get("limit")  ?? 20), 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const recId  = url.searchParams.get("rec_id") ?? undefined;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("evaluation_runs")
    .select("id, rec_id, dataset_id, trace_id, mode, status, overall_score, n_samples, edge_cases, current_model, target_model, started_at, completed_at, cost_usd, created_at", { count: "exact" })
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (recId) query = query.eq("rec_id", recId);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to fetch evaluations" }, { status: 500 });

  return NextResponse.json({ runs: data ?? [], total: count ?? 0, limit, offset });
}

// ── POST /api/evaluations ─────────────────────────────────────────────────────
// Creates an evaluation_run row (status=pending) and returns its id.
// The caller is responsible for kicking off the validation job via
// POST /api/engine/validate (same flow used by the Engine dashboard).

const CreateEvalSchema = z.object({
  rec_id:      z.string().min(1),
  mode:        z.enum(["synthetic", "real"]),
  dataset_id:  z.string().uuid().optional(),
  trace_id:    z.string().optional(),
  n_samples:   z.number().int().min(1).max(100).default(20),
  current_model: z.string().min(1),
  target_model:  z.string().min(1),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot create evaluations" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateEvalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  }

  const { rec_id, mode, dataset_id, trace_id, n_samples, current_model, target_model } = parsed.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("evaluation_runs")
    .insert({
      org_id:        member.org_id,
      rec_id,
      mode,
      dataset_id:    dataset_id ?? null,
      trace_id:      trace_id   ?? null,
      status:        "pending",
      n_samples,
      current_model,
      target_model,
      started_at:    new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create evaluation run" }, { status: 500 });
  }

  return NextResponse.json({ run_id: data.id }, { status: 201 });
}
