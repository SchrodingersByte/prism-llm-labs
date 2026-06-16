/**
 * /api/evaluations/configs (PRD-1)
 *
 * GET    — list the org's online-eval configs.
 * POST   — create a config.
 * PUT    ?id=  — update a config.
 * DELETE ?id=  — delete a config.
 *
 * Writes require canWriteOrg (owner/administrator/developer; read_only blocked).
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { canWriteOrg } from "@/lib/supabase/metrics-scope";

export const runtime = "nodejs";

const ScorerEnum = z.enum([
  "rubric", "faithfulness", "answer_relevancy", "context_precision",
  "context_recall", "toxicity", "hallucination",
]);

const ConfigSchema = z.object({
  name:        z.string().min(1).max(200),
  project_id:  z.string().uuid().nullable().optional(),
  judge_model: z.string().min(1).max(100).default("claude-haiku-4-5"),
  rubric:      z.string().max(4000).nullable().optional(),
  scorers:     z.array(ScorerEnum).min(1).default(["rubric"]),
  sampling:    z.object({
    rate:  z.number().min(0).max(1).default(0.05),
    tiers: z.record(z.number()).default({}),
  }).default({ rate: 0.05, tiers: {} }),
  scope:       z.object({
    model:   z.string().optional(),
    feature: z.string().optional(),
    tag:     z.string().optional(),
  }).default({}),
  enabled:     z.boolean().default(true),
});

async function authWrite(): Promise<{ orgId: string; userId: string } | NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await canWriteOrg(user.id, member.org_id))) {
    return NextResponse.json({ error: "Read-only members cannot manage eval configs" }, { status: 403 });
  }
  return { orgId: member.org_id, userId: user.id };
}

export async function GET(): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("eval_configs")
    .select("id, project_id, name, judge_model, rubric, scorers, sampling, scope, enabled, created_at, updated_at")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Failed to load configs" }, { status: 500 });
  return NextResponse.json({ configs: data ?? [] });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await authWrite();
  if (auth instanceof NextResponse) return auth;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("eval_configs")
    .insert({ org_id: auth.orgId, created_by: auth.userId, ...parsed.data, project_id: parsed.data.project_id ?? null })
    .select("id")
    .single();

  if (error || !data) return NextResponse.json({ error: "Failed to create config" }, { status: 500 });
  return NextResponse.json({ id: data.id }, { status: 201 });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await authWrite();
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = ConfigSchema.partial().safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("eval_configs")
    .update(parsed.data)
    .eq("id", id)
    .eq("org_id", auth.orgId);

  if (error) return NextResponse.json({ error: "Failed to update config" }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await authWrite();
  if (auth instanceof NextResponse) return auth;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id query param required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("eval_configs")
    .delete()
    .eq("id", id)
    .eq("org_id", auth.orgId);

  if (error) return NextResponse.json({ error: "Failed to delete config" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
