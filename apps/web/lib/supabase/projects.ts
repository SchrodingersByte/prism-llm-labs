import { createAdminClient } from "./server";

export interface UserProject {
  project_id:           string;
  project_name:         string;
  org_id:               string;
  org_name:             string;
  /** "owner" = org owner; "member" = everyone else */
  user_role:            "owner" | "member";
  /** Whether this user can manage the project (org owner/admin or project administrator) */
  is_project_owner:     boolean;
  /** Whether this user is a project-scoped collaborator (member_project_roles grant) */
  is_collaborator:      boolean;
  /** Whether this user may view project logs (managers always; refined by log-access in WS2c) */
  log_access_approved:  boolean;
  /** Retained for response shape; no longer tracked (member_project_roles has no invited_by) */
  assigned_by:          string | null;
  assigned_by_name:     string | null;
  created_at:           string;
  status:               "active" | "inactive";
  /** true = can edit/delete the project */
  can_manage:           boolean;
}

/**
 * Returns every project the user can access across ALL orgs they belong to.
 *
 * New scope model:
 *   org-scoped member (scope_type='organization') → every project in that org,
 *     with their org-wide role.
 *   project-scoped member (scope_type='project')  → only projects granted via
 *     member_project_roles (keyed by members.id).
 */
export async function getAllUserProjects(userId: string): Promise<UserProject[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  // 1 — All org memberships for this user (id, scope, role, org name)
  const { data: memberships } = await admin
    .from("members")
    .select("id, org_id, role, scope_type, organizations(id, name)")
    .eq("user_id", userId) as {
      data: Array<{
        id: string;
        org_id: string;
        role: string | null;
        scope_type: string;
        organizations: { id: string; name: string } | null;
      }> | null;
    };

  if (!memberships?.length) return [];

  const orgIds = memberships.map(m => m.org_id);
  const orgByOrgId = new Map(memberships.map(m => [m.org_id, m]));

  // 2 — All projects in those orgs
  const { data: projects } = await admin
    .from("projects")
    .select("id, name, org_id, created_at, status")
    .in("org_id", orgIds)
    .order("created_at", { ascending: false }) as {
      data: Array<{ id: string; name: string; org_id: string; created_at: string; status: string | null }> | null;
    };

  if (!projects?.length) return [];

  // 3 — Per-project grants for this user's PROJECT-SCOPED memberships
  const projectScopedMemberIds = memberships.filter(m => m.scope_type === "project").map(m => m.id);
  const { data: grants } = projectScopedMemberIds.length
    ? await admin.from("member_project_roles").select("project_id, role").in("member_id", projectScopedMemberIds) as {
        data: Array<{ project_id: string; role: string }> | null;
      }
    : { data: [] as Array<{ project_id: string; role: string }> };

  const grantByProject = new Map((grants ?? []).map(g => [g.project_id, g]));

  // 4 — Keep only projects the user can actually see, then enrich
  return projects
    .filter(p => {
      const om = orgByOrgId.get(p.org_id);
      return om?.scope_type === "organization" || grantByProject.has(p.id);
    })
    .map(p => {
      const om        = orgByOrgId.get(p.org_id);
      const orgScoped = om?.scope_type === "organization";
      const orgRole   = om?.role ?? null;
      const grant     = grantByProject.get(p.id);

      const isOrgOwner = orgScoped && orgRole === "owner";
      const canManage  =
        isOrgOwner ||
        (orgScoped && orgRole === "administrator") ||
        grant?.role === "owner" ||
        grant?.role === "administrator";
      const isCollaborator = !orgScoped && Boolean(grant);

      return {
        project_id:          p.id,
        project_name:        p.name,
        org_id:              p.org_id,
        org_name:            om?.organizations?.name ?? "",
        user_role:           isOrgOwner ? "owner" : "member",
        is_project_owner:    canManage,
        is_collaborator:     isCollaborator,
        log_access_approved: canManage,
        assigned_by:         null,
        assigned_by_name:    null,
        created_at:          p.created_at,
        status:              (p.status ?? "active") as "active" | "inactive",
        can_manage:          canManage,
      } satisfies UserProject;
    });
}
