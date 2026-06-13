import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { encryptKey } from "@/lib/crypto/keys";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const CreateSchema = z.object({
  provider:                z.enum(["openai", "anthropic", "azure_openai", "google", "ollama", "openai_compatible", "groq", "xai", "fireworks", "together", "perplexity", "mistral", "cerebras", "nebius", "cohere", "bedrock"]),
  key:                     z.string().optional().default(""),
  name:                    z.string().min(1).max(100),
  description:             z.string().max(500).optional(),
  account_label:           z.string().max(100).optional(),
  project_id:              z.string().uuid().optional(),
  azure_endpoint:          z.string().url().optional(),
  custom_endpoint:         z.string().url().optional(),
  use_for_reconciliation:  z.boolean().optional().default(false),
  /** Allowlist of model names. Empty = unrestricted (any model passes). */
  allowed_models:          z.array(z.string()).optional().default([]),
  data_region:             z.enum(["global", "eu", "us", "in"]).optional().default("global"),
  // AWS Bedrock credentials (only used when provider = "bedrock")
  access_key_id:           z.string().optional(),
  secret_access_key:       z.string().optional(),
  aws_region:              z.string().optional(),
});

export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("provider_keys")
    // description & account_label were dropped; the api_keys(...) reverse embed relied
    // on the dropped api_keys.provider_key_id FK — active_key_count is now derived
    // from key_provider_links below.
    .select(`
      id, provider, key_hint, azure_endpoint, custom_endpoint, is_active, created_at,
      name, project_id, use_for_reconciliation,
      allowed_models, data_region,
      projects ( name )
    `)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  // active_key_count via key_provider_links → api_keys (two-step to avoid relying on
  // a reverse embed). Counts active Prism keys linked to each provider key.
  const pkIds = (data as Array<{ id: string }>).map((pk) => pk.id);
  const activeCountByPk = new Map<string, number>();
  if (pkIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: links } = await (admin as any)
      .from("key_provider_links")
      .select("provider_key_id, api_key_id")
      .in("provider_key_id", pkIds);
    const linkRows = (links ?? []) as Array<{ provider_key_id: string; api_key_id: string }>;
    const apiKeyIds = Array.from(new Set(linkRows.map((l) => l.api_key_id)));
    const activeApiKeyIds = new Set<string>();
    if (apiKeyIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: aks } = await (admin as any)
        .from("api_keys")
        .select("id")
        .in("id", apiKeyIds)
        .eq("is_active", true);
      for (const a of (aks ?? []) as Array<{ id: string }>) activeApiKeyIds.add(a.id);
    }
    for (const l of linkRows) {
      if (activeApiKeyIds.has(l.api_key_id)) {
        activeCountByPk.set(l.provider_key_id, (activeCountByPk.get(l.provider_key_id) ?? 0) + 1);
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = (data as any[]).map((pk) => ({
    ...pk,
    description:      null,                            // column dropped — shape preserved
    project_name:     pk.projects?.name ?? null,
    active_key_count: activeCountByPk.get(pk.id) ?? 0,
    projects:  undefined,
  }));

  return NextResponse.json({ data: enriched });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });
  }

  // description & account_label were dropped from provider_keys — accepted by the
  // schema for backward compat but not destructured/persisted.
  const { provider, key, name, project_id,
          azure_endpoint, custom_endpoint, use_for_reconciliation,
          allowed_models, data_region } = parsed.data;
  const admin = createAdminClient();

  const isBedrock = provider === "bedrock";

  // Validate key requirements per provider
  const isLocal = provider === "ollama" || provider === "openai_compatible";
  if (isBedrock) {
    const { access_key_id: akid, secret_access_key: sak, aws_region: ar } = parsed.data;
    if (!akid || !sak) {
      return NextResponse.json(
        { error: "access_key_id and secret_access_key are required for Bedrock" }, { status: 400 },
      );
    }
    if (!ar) {
      return NextResponse.json(
        { error: "aws_region is required for Bedrock (e.g. \"us-east-1\")" }, { status: 400 },
      );
    }
  } else if (!isLocal && !key) {
    return NextResponse.json({ error: "key is required for this provider" }, { status: 400 });
  }
  if (isLocal && !custom_endpoint) {
    return NextResponse.json({ error: "custom_endpoint is required for local providers" }, { status: 400 });
  }

  if (project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects")
      .select("id")
      .eq("id", project_id)
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // For Bedrock: encode credentials as JSON; use last 4 chars of access_key_id as hint
  const { access_key_id, secret_access_key, aws_region } = parsed.data;
  const keyForEncryption = isBedrock
    ? JSON.stringify({ accessKeyId: access_key_id, secretAccessKey: secret_access_key })
    : key;
  const key_hint      = isBedrock
    ? (access_key_id?.slice(-4) ?? "")
    : (key ? key.slice(-4) : (custom_endpoint?.slice(-4) ?? ""));
  const key_encrypted = keyForEncryption ? encryptKey(keyForEncryption) : "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: dbErr } = await (admin as any)
    .from("provider_keys")
    .insert({
      org_id:         ctx.orgId,
      provider,
      key_encrypted,
      key_hint,
      name,
      project_id:              project_id       ?? null,
      azure_endpoint:          azure_endpoint   ?? null,
      custom_endpoint:         custom_endpoint  ?? null,
      use_for_reconciliation:  use_for_reconciliation ?? false,
      allowed_models:          allowed_models ?? [],
      data_region:             data_region ?? "global",
      aws_region:              isBedrock ? (aws_region ?? null) : null,
    })
    .select("id, provider, key_hint, azure_endpoint, custom_endpoint, is_active, created_at, name, project_id, allowed_models, data_region")
    .single();

  if (dbErr) {
    console.error("provider-keys insert error:", dbErr);
    return NextResponse.json({ error: "Failed to save key", detail: dbErr.message }, { status: 500 });
  }

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action:      "provider.connected",
    targetType:  "provider_key",
    targetId:    inserted.id,
    metadata:    { provider, name, project_id: project_id ?? null },
  });

  return NextResponse.json({ data: { ...inserted, description: null } }, { status: 201 });
}
