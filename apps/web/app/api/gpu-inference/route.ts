/**
 * POST /api/gpu-inference  — record GPU inference cost events
 * GET  /api/gpu-inference  — list GPU inference runs for the org
 *
 * Auth: Prism API key (Authorization: Bearer {key})
 *
 * Use this to track costs from SageMaker endpoints, Lambda GPU invocations,
 * RunPod, Modal, or Vertex AI prediction endpoints — costs that aren't
 * token-based but still belong in the total AI infrastructure picture.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const GPU_PROVIDERS = ["aws_sagemaker", "lambda_labs", "runpod", "modal", "vertex_ai", "azure_ml", "other"] as const;

const RunSchema = z.object({
  provider:         z.enum(GPU_PROVIDERS),
  endpoint_name:    z.string().min(1).max(200),
  instance_type:    z.string().max(100).optional(),
  start_time:       z.string().optional(),
  end_time:         z.string().optional(),
  duration_seconds: z.number().int().nonnegative().optional(),
  cost_usd:         z.number().nonnegative(),
  requests:         z.number().int().nonnegative().optional(),
  session_id:       z.string().max(200).optional(),
  tags:             z.record(z.unknown()).optional(),
});

const BatchSchema = z.object({
  runs: z.array(RunSchema).min(1).max(100),
});

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const apiKey     = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const keyHash = createHash("sha256").update(apiKey).digest("hex");
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, is_active, expires_at")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    return NextResponse.json({ error: "Invalid or inactive API key" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Support single run or batch envelope
  const normalised = (body as Record<string, unknown>)?.runs
    ? body
    : { runs: [body] };

  const parsed = BatchSchema.safeParse(normalised);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const orgId = keyRow.org_id as string;
  const keyId = (keyRow as { id: string }).id;

  const rows = parsed.data.runs.map(r => ({
    org_id:           orgId,
    api_key_id:       keyId,
    provider:         r.provider,
    endpoint_name:    r.endpoint_name,
    instance_type:    r.instance_type    ?? null,
    start_time:       r.start_time       ?? null,
    end_time:         r.end_time         ?? null,
    duration_seconds: r.duration_seconds ?? null,
    cost_usd:         r.cost_usd,
    requests:         r.requests         ?? null,
    session_id:       r.session_id       ?? null,
    tags:             r.tags             ?? null,
  }));

  const { error } = await supabaseAdmin.from("gpu_inference_runs").insert(rows);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, recorded: rows.length });
}

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const from  = req.nextUrl.searchParams.get("from");
  const to    = req.nextUrl.searchParams.get("to");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("gpu_inference_runs")
    .select("id, provider, endpoint_name, instance_type, cost_usd, requests, duration_seconds, start_time, end_time, session_id, tags, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (from) query = query.gte("created_at", from);
  if (to)   query = query.lte("created_at", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
