import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

/**
 * GET /api/my/projects — projects the caller can access in their active org.
 *   org-scoped member (any role) → every project in the org
 *   project-scoped member        → only projects granted via member_project_roles
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
    .from("members").select("id, scope_type, role")
    .eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle() as
    { data: { id: string; scope_type: string; role: string | null } | null };
  if (!m) return NextResponse.json({ data: [] });

  if (m.scope_type === "organization") {
    const { data: projects } = await admin
      .from("projects").select("id, name, slug, description, created_at")
      .eq("org_id", member.org_id).order("created_at", { ascending: false });
    return NextResponse.json({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: (projects ?? []).map((p: any) => ({
        id: p.id, name: p.name, slug: p.slug, description: p.description,
        role: m.role, joined_at: p.created_at, invited_by: null,
      })),
    });
  }

  // Project-scoped → assigned projects via member_project_roles (keyed by member_id)
  const { data: grants } = await admin
    .from("member_project_roles")
    .select("role, created_at, projects ( id, name, slug, description, org_id, created_at )")
    .eq("member_id", m.id) as {
      data: Array<{
        role: string; created_at: string;
        projects: { id: string; name: string; slug: string; description: string | null; org_id: string; created_at: string } | null;
      }> | null;
    };

  const data = (grants ?? [])
    .filter(g => g.projects?.org_id === member.org_id)
    .map(g => ({
      id: g.projects!.id, name: g.projects!.name, slug: g.projects!.slug,
      description: g.projects!.description, role: g.role, joined_at: g.created_at, invited_by: null,
    }));

  return NextResponse.json({ data });
}
