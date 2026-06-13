/**
 * GET  /api/training-runs  — list training runs for the org
 * POST /api/training-runs  — manually create a training run entry (owner/administrator)
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

const CreateSchema = z.object({
  run_id:           z.string().min(1).max(200),
  provider:         z.enum(["openai", "anthropic", "aws_sagemaker", "gcp_vertex", "azure_ml", "manual"]),
  display_name:     z.string().max(200).optional(),
  training_type:    z.enum(["fine_tune", "full_training", "distillation", "embedding"]).default("fine_tune"),
  base_model:       z.string().max(200).optional(),
  fine_tuned_model: z.string().max(200).optional(),
  status:           z.enum(["pending", "running", "completed", "failed", "cancelled"]).default("running"),
  started_at:       z.string().datetime().optional(),
  completed_at:     z.string().datetime().optional(),
  cost_usd:         z.number().min(0).optional(),
  tokens_trained:   z.number().int().min(0).optional(),
  dataset_size_mb:  z.number().min(0).optional(),
  epochs:           z.number().int().min(1).optional(),
  cost_center_code: z.string().max(50).optional(),
  project_id:       z.string().uuid().optional(),
  config:           z.record(z.unknown()).default({}),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const guard = await checkFeature(member.org_id, "training_runs");
  if (guard) return guard;

  const status = req.nextUrl.searchParams.get("status");
  const from   = req.nextUrl.searchParams.get("from");
  const to     = req.nextUrl.searchParams.get("to");

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("training_runs")
    .select("id, run_id, provider, display_name, training_type, base_model, fine_tuned_model, status, started_at, completed_at, cost_usd, tokens_trained, dataset_size_mb, epochs, cost_center_code, workload_type, project_id, config, created_at")
    .eq("org_id", member.org_id)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (status)   query = query.eq("status", status);
  if (from)     query = query.gte("started_at", from);
  if (to)       query = query.lte("started_at", to);

  const { data } = await query;
  return NextResponse.json({ data: data ?? [] });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: insertErr } = await (admin as any)
    .from("training_runs")
    .insert({ org_id: member.org_id, workload_type: "model_training", ...body.data })
    .select()
    .single();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
