import { NextRequest, NextResponse } from "next/server";
import { requireAuth, type AuthContext } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { generatePrismKey } from "@/lib/keys/generate";
import { writeAuditLog } from "@/lib/audit/log";
import { z } from "zod";

const CreateKeySchema = z.object({
  name:              z.string().min(1).max(100),
  description:       z.string().max(500).optional(),
  environment:       z.enum(["production", "staging", "development"]).default("production"),
  project_id:        z.string().uuid().optional(),
  provider_key_id:   z.string().uuid().optional(),
  // Gateway keys: link one or more provider keys (one per provider for multi-provider routing)
  provider_key_ids:  z.array(z.string().uuid()).optional(),
  expires_at:        z.string().datetime().optional(),
  tags:              z.record(z.string()).optional(),
  // Key modification controls
  cost_hard_cap_usd:  z.number().positive().optional(),
  daily_cost_cap_usd: z.number().positive().optional(),
  renewal_period:     z.enum(["monthly", "quarterly", "annual", "none"]).optional(),
  usage_buffer_pct:   z.number().int().min(0).max(100).optional(),
  auto_renew:         z.boolean().optional(),
});

/**
 * Can the caller WRITE (create keys for) this project? Mirrors can_write_project():
 *   org-scoped owner/administrator/developer → any project (read_only excluded)
 *   project-scoped → an owner/administrator/developer grant on this project
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canWriteProject(admin: any, ctx: AuthContext, projectId: string): Promise<boolean> {
  if (ctx.scopeType === "organization") {
    return ctx.role === "owner" || ctx.role === "administrator" || ctx.role === "developer";
  }
  const { data: m } = await admin.from("members").select("id").eq("org_id", ctx.orgId).eq("user_id", ctx.user.id).maybeSingle() as { data: { id: string } | null };
  if (!m) return false;
  const { data: g } = await admin.from("member_project_roles").select("role").eq("member_id", m.id).eq("project_id", projectId).maybeSingle() as { data: { role: string } | null };
  return g?.role === "owner" || g?.role === "administrator" || g?.role === "developer";
}

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const isPrivileged = ctx.isOwner;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("api_keys")
    // api_keys is slimmed: provider linking lives in key_provider_links, and
    // description/provider_key_id/assigned_user_id were dropped. Embed the
    // provider via the junction table.
    .select(`
      id, name, key_prefix, environment, project_id, is_active, created_at,
      last_used_at, expires_at, tags,
      key_provider_links ( provider_keys ( name, provider ) ),
      projects ( name )
    `)
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false });

  // NOTE: api_keys.assigned_user_id was dropped, so per-user key scoping is not
  // currently modelled — all org members see their org's keys.
  void isPrivileged;

  query = query.eq("is_active", true);

  const projectId = req.nextUrl.searchParams.get("project_id");
  if (projectId) {
    query = query.eq("project_id", projectId);
  }

  const { data: keys, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = (keys as any[]).map(k => {
    const pk = k.key_provider_links?.[0]?.provider_keys ?? null;
    return {
      ...k,
      provider_key_name:        pk?.name ?? null,
      provider_key_description: pk?.description ?? null,
      provider:                 pk?.provider ?? null,
      project_name:             k.projects?.name ?? null,
      key_provider_links:       undefined,
      projects:                 undefined,
    };
  });

  return NextResponse.json({ data: enriched });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json({ error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { project_id } = parsed.data;
  let { provider_key_id } = parsed.data;

  // Merge legacy single provider_key_id into the provider_key_ids array.
  let allProviderKeyIds: string[] = [
    ...(parsed.data.provider_key_ids ?? []),
    ...(provider_key_id ? [provider_key_id] : []),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  // Linking provider keys (a gateway key routing to org secrets) is privileged —
  // org owner/administrator only. Non-admins silently get an analytics key
  // (provider links stripped), matching prior behaviour.
  if (!ctx.canManage) {
    allProviderKeyIds = [];
    provider_key_id   = undefined;
  }

  // A project_id is required unless this is an admin gateway key that inherits
  // its project from a linked provider key.
  if (!project_id && allProviderKeyIds.length === 0) {
    return NextResponse.json({ error: "project_id is required" }, { status: 400 });
  }

  if (project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects").select("id").eq("id", project_id).eq("org_id", ctx.orgId).maybeSingle();
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    // Per-project write gate (service-role client bypasses RLS — enforce here).
    if (!ctx.canManage && !(await canWriteProject(admin, ctx, project_id))) {
      return NextResponse.json({ error: "You cannot create keys for this project" }, { status: 403 });
    }
  }

  let resolvedProjectId = project_id ?? null;
  if (allProviderKeyIds.length > 0) {
    // Validate all linked provider keys belong to this org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: pks } = await (admin as any)
      .from("provider_keys")
      .select("id, project_id")
      .in("id", allProviderKeyIds)
      .eq("org_id", ctx.orgId)
      .eq("is_active", true) as { data: { id: string; project_id: string | null }[] | null };
    if (!pks || pks.length !== allProviderKeyIds.length) {
      return NextResponse.json({ error: "One or more provider keys not found" }, { status: 404 });
    }
    // Inherit project from the first provider key if not explicitly set
    if (!resolvedProjectId) resolvedProjectId = pks[0]?.project_id ?? null;
    provider_key_id = allProviderKeyIds[0];
  }

  const { rawKey, keyHash, keyPrefix } = generatePrismKey(parsed.data.environment, ctx.orgId);

  // api_keys is slimmed — spend caps live in key_caps, provider linking in
  // key_provider_links; user_id/assigned_user_id/description/renewal/buffer dropped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error: insertErr } = await (admin as any)
    .from("api_keys")
    .insert({
      org_id:      ctx.orgId,
      project_id:  resolvedProjectId,
      key_hash:    keyHash,
      key_prefix:  keyPrefix,
      name:        parsed.data.name,
      environment: parsed.data.environment,
      expires_at:  parsed.data.expires_at ?? null,
      tags:        parsed.data.tags ?? {},
      is_active:   true,
    })
    .select("id, name, key_prefix, environment, project_id, created_at, expires_at, tags")
    .single();

  if (insertErr) return NextResponse.json({ error: "Failed to create key" }, { status: 500 });

  // Junction rows for all linked provider keys
  if (allProviderKeyIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("key_provider_links")
      .upsert(
        allProviderKeyIds.map((pkId) => ({ api_key_id: inserted.id, provider_key_id: pkId })),
        { onConflict: "api_key_id,provider_key_id", ignoreDuplicates: true },
      );
  }

  // Spend caps live in key_caps (one row per period).
  const caps: { api_key_id: string; amount_usd: number; period: string }[] = [];
  if (parsed.data.cost_hard_cap_usd)  caps.push({ api_key_id: inserted.id, amount_usd: parsed.data.cost_hard_cap_usd,  period: "monthly" });
  if (parsed.data.daily_cost_cap_usd) caps.push({ api_key_id: inserted.id, amount_usd: parsed.data.daily_cost_cap_usd, period: "daily" });
  if (caps.length) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("key_caps").insert(caps);
  }

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "key.created", targetType: "api_key", targetId: inserted.id,
    metadata: { name: parsed.data.name, environment: parsed.data.environment, provider_key_id: provider_key_id ?? null },
  });

  return NextResponse.json({ data: { ...inserted, key: rawKey } }, { status: 201 });
}
