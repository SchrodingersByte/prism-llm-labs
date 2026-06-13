import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

const CandidateSchema = z.object({
  model:    z.string().min(1),
  provider: z.enum([
    "openai", "anthropic", "google", "azure_openai", "openrouter",
    "groq", "xai", "fireworks", "together", "perplexity",
    "mistral", "cerebras", "nebius", "cohere",
    "bedrock", "ollama", "openai_compatible",
  ]),
  weight: z.number().int().min(0).max(100).optional(),
});

const RuleSchema = z.object({
  primary_model:       z.string().min(1),
  fallback_candidates: z.array(CandidateSchema).optional(),
  fallback_models:     z.array(z.string()).optional(),
  trigger_on_codes:    z.array(z.number().int()).default([429, 503]),
  /**
   * Optional: scope this rule to a specific Prism API key.
   * When omitted the rule is org-wide and applies to all keys
   * that have no key-specific override for this model.
   */
  api_key_id:          z.string().uuid().optional(),
}).refine(
  (d) => (d.fallback_candidates?.length ?? 0) > 0 || (d.fallback_models?.length ?? 0) > 0,
  { message: "Provide fallback_candidates or fallback_models" },
);

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("model_routing_rules" as any)
    .select(`
      id, primary_model, fallback_candidates, fallback_models,
      trigger_on_codes, is_active, created_at, api_key_id,
      api_keys ( name, key_prefix )
    `)
    .eq("org_id", member.org_id)
    .order("primary_model");

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const guard = await checkFeature(member.org_id, "routing_rules");
  if (guard) return guard;

  const body = RuleSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { primary_model, fallback_candidates, fallback_models, trigger_on_codes, api_key_id } = body.data;

  // Validate api_key_id belongs to this org if provided
  if (api_key_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: key } = await (admin as any)
      .from("api_keys")
      .select("id")
      .eq("id", api_key_id)
      .eq("org_id", member.org_id)
      .eq("is_active", true)
      .maybeSingle();
    if (!key) return NextResponse.json({ error: "API key not found in this org" }, { status: 404 });
  }

  const payload = {
    fallback_candidates: fallback_candidates ?? null,
    fallback_models:     fallback_candidates?.map(c => c.model) ?? (fallback_models ?? []),
    trigger_on_codes,
    is_active:           true,
  };

  // Manual upsert: check for existing rule matching (org, api_key_id, primary_model)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let existingQuery = (admin as any)
    .from("model_routing_rules" as any)
    .select("id")
    .eq("org_id", member.org_id)
    .eq("primary_model", primary_model);
  existingQuery = api_key_id
    ? existingQuery.eq("api_key_id", api_key_id)
    : existingQuery.is("api_key_id", null);

  const { data: existing } = await existingQuery.maybeSingle() as { data: { id: string } | null };

  let data, dbErr;
  if (existing) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data, error: dbErr } = await (admin as any)
      .from("model_routing_rules" as any)
      .update(payload)
      .eq("id", existing.id)
      .select(`id, primary_model, fallback_candidates, fallback_models, trigger_on_codes, is_active, created_at, api_key_id, api_keys(name, key_prefix)`)
      .single());
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ data, error: dbErr } = await (admin as any)
      .from("model_routing_rules" as any)
      .insert({ org_id: member.org_id, primary_model, api_key_id: api_key_id ?? null, ...payload })
      .select(`id, primary_model, fallback_candidates, fallback_models, trigger_on_codes, is_active, created_at, api_key_id, api_keys(name, key_prefix)`)
      .single());
  }

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ data }, { status: existing ? 200 : 201 });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const { id } = await req.json().catch(() => ({ id: null }));
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("model_routing_rules" as any)
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  return NextResponse.json({ ok: true });
}
