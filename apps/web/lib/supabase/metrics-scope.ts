import { NextResponse } from "next/server";
import { createAdminClient } from "./server";
import type { AuthContext } from "./auth";

/**
 * Project IDs a user may see metrics for, within their active org.
 *
 *   org-scoped member (any role) → null      (unrestricted — every project in the org)
 *   project-scoped member        → string[]  (only projects granted via
 *                                              member_project_roles; may be empty)
 *
 * Scope is decided by members.scope_type, NOT role: an org-wide developer or
 * read_only sees all projects; only project-scoped members are clamped. Grants
 * live in member_project_roles keyed by members.id, so we resolve the caller's
 * member row first, then their grants.
 */
export async function getAccessibleProjectIds(
  ctx: AuthContext,
): Promise<string[] | null> {
  if (ctx.scopeType === "organization") return null; // org-wide role → all projects

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;

  const { data: m } = await admin
    .from("members").select("id")
    .eq("org_id", ctx.orgId).eq("user_id", ctx.user.id).maybeSingle() as { data: { id: string } | null };
  if (!m) return [];

  const { data: grants } = await admin
    .from("member_project_roles").select("project_id").eq("member_id", m.id) as {
      data: Array<{ project_id: string | null }> | null;
    };

  const ids = Array.from(new Set((grants ?? []).map(g => g.project_id).filter((id): id is string => !!id)));
  if (ids.length === 0) return [];

  // Clamp to the active org (defensive — grants already belong to this org).
  const { data: projs } = await admin
    .from("projects").select("id").eq("org_id", ctx.orgId).in("id", ids) as { data: Array<{ id: string }> | null };

  return (projs ?? []).map(p => p.id);
}

/**
 * Clamps a requested project filter to what the caller may see, and resolves
 * the `projectIds` list to pass to Tinybird pipes (which filter `project_id IN
 * (...)` when the list is non-empty).
 *
 *   ok        — pass `projectId` (single, '' = none) + `projectIds` (list, [] = no list filter)
 *   empty     — project-scoped member with zero grants → caller returns empty data
 *   forbidden — project-scoped member requested a project they're not granted → 403
 *
 * Org-scoped: projectIds is always [] (no restriction); projectId honors their
 * explicit selection. Project-scoped: when no specific project is selected,
 * projectIds is their full granted set; when they select one of theirs, projectId
 * narrows to it.
 */
export type MetricsScope =
  | { kind: "ok"; projectId: string; projectIds: string[] }
  | { kind: "empty" }
  | { kind: "forbidden" };

export async function resolveMetricsScope(
  ctx: AuthContext,
  requestedProjectId: string,
): Promise<MetricsScope> {
  const accessible = await getAccessibleProjectIds(ctx);

  // org-scoped — unrestricted; honor explicit selection, no list filter.
  if (accessible === null) {
    return { kind: "ok", projectId: requestedProjectId, projectIds: [] };
  }

  // project-scoped
  if (accessible.length === 0) return { kind: "empty" };

  if (requestedProjectId) {
    return accessible.includes(requestedProjectId)
      ? { kind: "ok", projectId: requestedProjectId, projectIds: [] }
      : { kind: "forbidden" };
  }

  // No specific project → aggregate across all granted projects.
  return { kind: "ok", projectId: "", projectIds: accessible };
}

/** Standard 403 for a project-scoped member reaching outside their granted projects. */
export function forbiddenScope(): NextResponse {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

/**
 * True if the user is an org-scoped owner or administrator. Lightweight guard for
 * the metrics routes that use the manual getUser()+getMemberOrg() auth style.
 * Owner/admin-only views (FinOps, governance, enterprise) call this; everyone
 * else gets a 403.
 */
export async function isOrgManager(userId: string, orgId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("members").select("role, scope_type")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { role: string | null; scope_type: string | null } | null };
  return data?.scope_type === "organization" && (data?.role === "owner" || data?.role === "administrator");
}

/**
 * True if the user is an org-scoped WRITER (owner/administrator/developer —
 * excludes read_only and project-scoped). Mirrors the can_write_org() RLS helper;
 * gate for org-level content writes (evaluations, requests) on routes using the
 * manual getUser()+getMemberOrg() auth style.
 */
export async function canWriteOrg(userId: string, orgId: string): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data } = await admin
    .from("members").select("role, scope_type")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { role: string | null; scope_type: string | null } | null };
  return data?.scope_type === "organization" && ["owner", "administrator", "developer"].includes(data?.role ?? "");
}

/** member_project_roles ∩ org → a project-scoped member's accessible project IDs. */
async function projectScopedProjectIds(userId: string, orgId: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: m } = await admin
    .from("members").select("id, scope_type")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { id: string; scope_type: string } | null };
  if (!m || m.scope_type !== "project") return [];

  const { data: grants } = await admin
    .from("member_project_roles").select("project_id").eq("member_id", m.id) as {
      data: Array<{ project_id: string | null }> | null;
    };
  const ids = Array.from(new Set((grants ?? []).map(g => g.project_id).filter((id): id is string => !!id)));
  if (ids.length === 0) return [];
  const { data: projs } = await admin
    .from("projects").select("id").eq("org_id", orgId).in("id", ids) as { data: Array<{ id: string }> | null };
  return (projs ?? []).map(p => p.id);
}

/**
 * AuthContext-free scope resolver for metrics routes using the manual
 * getUser()+getMemberOrg() style. Org-scoped members (any role) are unrestricted;
 * project-scoped members are clamped to their grants.
 */
export async function resolveMetricsScopeFor(
  userId:             string,
  orgId:              string,
  requestedProjectId: string,
): Promise<MetricsScope> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: m } = await admin
    .from("members").select("scope_type")
    .eq("org_id", orgId).eq("user_id", userId).maybeSingle() as { data: { scope_type: string } | null };

  const accessible = m?.scope_type === "organization"
    ? null
    : await projectScopedProjectIds(userId, orgId);

  if (accessible === null) return { kind: "ok", projectId: requestedProjectId, projectIds: [] };
  if (accessible.length === 0) return { kind: "empty" };
  if (requestedProjectId) {
    return accessible.includes(requestedProjectId)
      ? { kind: "ok", projectId: requestedProjectId, projectIds: [] }
      : { kind: "forbidden" };
  }
  return { kind: "ok", projectId: "", projectIds: accessible };
}
