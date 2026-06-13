import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { invalidateGuardrailsCache } from "@/lib/gateway/guardrails/store";
import { z } from "zod";

// Guardrail PROFILES CRUD — reusable check configs referenced by rules.
// Reads: any org member. Writes: org owner/administrator only (governance) —
// enforced explicitly because the admin client bypasses RLS.

const CustomPatternSchema = z.object({
  name:    z.string().min(1),
  pattern: z.string().min(1),
  enabled: z.boolean(),
});

const ProfileSchema = z.object({
  name:            z.string().min(1),
  type:            z.enum(["builtin_pii", "bedrock", "azure"]).default("builtin_pii"),
  pii_types:       z.array(z.string()).optional(),
  custom_patterns: z.array(CustomPatternSchema).optional(),
  config:          z.record(z.any()).optional(),
});

const ProfilePatchSchema = z.object({
  id:              z.string().uuid(),
  name:            z.string().min(1).optional(),
  pii_types:       z.array(z.string()).nullable().optional(),
  custom_patterns: z.array(CustomPatternSchema).optional(),
  config:          z.record(z.any()).optional(),
});

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("guardrail_profiles" as any)
    .select("id, name, type, pii_types, custom_patterns, config, created_at")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: true });

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

  const body = ProfileSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  const { name, type, pii_types, custom_patterns, config } = body.data;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("guardrail_profiles" as any)
    .insert({
      org_id:          member.org_id,
      name,
      type,
      pii_types:       pii_types ?? null,
      custom_patterns: custom_patterns ?? [],
      config:          config ?? {},
    })
    .select("id, name, type, pii_types, custom_patterns, config, created_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  await invalidateGuardrailsCache(member.org_id);
  return NextResponse.json({ data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const body = ProfilePatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }
  const { id, ...patch } = body.data;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("guardrail_profiles" as any)
    .update(patch)
    .eq("id", id)
    .eq("org_id", member.org_id)
    .select("id, name, type, pii_types, custom_patterns, config, created_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  await invalidateGuardrailsCache(member.org_id);
  return NextResponse.json({ data });
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
    .from("guardrail_profiles" as any)
    .delete()
    .eq("id", id)
    .eq("org_id", member.org_id);

  await invalidateGuardrailsCache(member.org_id);  // cascade also drops dependent rules
  return NextResponse.json({ ok: true });
}
