import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

/**
 * GET /api/my/keys — API keys the caller can see in their active org.
 *   org-scoped member (any role) → all org keys
 *   project-scoped member        → keys for the projects they're granted
 *     (member_project_roles)
 * (api_keys.assigned_user_id was dropped, so keys are project-scoped, not user-scoped.)
 */
export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: m } = await admin
    .from("members").select("id, scope_type")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as { data: { id: string; scope_type: string } | null };
  if (!m) return NextResponse.json({ data: [] });

  // The provider_keys(...) embed was removed (api_keys.provider_key_id FK dropped) and
  // description dropped; both are returned as null below to keep the response shape stable.
  let query = admin
    .from("api_keys")
    .select(`
      id, name, key_prefix, environment,
      project_id, is_active, created_at, last_used_at, expires_at, tags,
      projects ( name )
    `)
    .eq("org_id", member.org_id)
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  if (m.scope_type === "project") {
    const { data: grants } = await admin.from("member_project_roles").select("project_id").eq("member_id", m.id) as {
      data: Array<{ project_id: string | null }> | null;
    };
    const ids = Array.from(new Set((grants ?? []).map(g => g.project_id).filter((id): id is string => !!id)));
    if (ids.length === 0) return NextResponse.json({ data: [] });
    query = query.in("project_id", ids);
  }

  const { data: keys, error: dbErr } = await query;
  if (dbErr) return NextResponse.json({ error: "DB error" }, { status: 500 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = (keys as any[]).map(k => ({
    id:                       k.id,
    name:                     k.name,
    description:              null,                 // column dropped — shape preserved
    key_prefix:               k.key_prefix,
    environment:              k.environment,
    project_id:               k.project_id,
    project_name:             k.projects?.name ?? null,
    provider_key_name:        null,                 // provider_keys embed removed
    provider_key_description: null,
    provider:                 null,
    is_active:                k.is_active,
    created_at:               k.created_at,
    last_used_at:             k.last_used_at,
    expires_at:               k.expires_at,
    tags:                     k.tags,
  }));

  return NextResponse.json({ data: enriched });
}
