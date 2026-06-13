import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "./server";
import type { User } from "@supabase/supabase-js";

/**
 * Org access-control roles (exact Supabase model):
 *   owner         — created the org; billing, plan, ownership transfer, org delete.
 *                   >= 1 per org; not an invitable role.
 *   administrator — elevated manager; manages org resources (keys, provider keys,
 *                   policies, budgets, members, projects, integrations). Not
 *                   billing or ownership transfer.
 *   developer     — collaborator; reads org metrics, writes content within scope.
 *                   Not org management.
 *   read_only     — reads everything in scope; writes nothing.
 *
 * Scope (members.scope_type):
 *   "organization" — role applies to ALL projects (role is NOT NULL).
 *   "project"      — role is NULL here; per-project grants live in
 *                    member_project_roles. A project-scoped member satisfies a
 *                    plain requireAuth() (they ARE a member) but fails any
 *                    { roles } gate (which checks the org-wide role) and has
 *                    canManage / canWrite = false at the ORG level — their writes
 *                    are authorized PER-PROJECT (member_project_roles /
 *                    can_write_project), not here.
 *
 * Legacy "admin" normalizes to "administrator"; legacy "member" to "developer".
 */
export type OrgRole = "owner" | "administrator" | "developer" | "read_only";
export type ScopeType = "organization" | "project";

export interface AuthContext {
  user:            User;
  orgId:           string;
  scopeType:       ScopeType;
  role:            OrgRole | null;  // null when scopeType === "project"
  isOwner:         boolean;         // org-scoped owner — billing, ownership, delete
  isAdministrator: boolean;         // org-scoped administrator — org resource mgmt
  isDeveloper:     boolean;         // org-scoped developer — content writer
  isReadOnly:      boolean;         // org-scoped read_only — no writes
  /** @deprecated use isAdministrator — temporary alias kept during the RBAC port */
  isAdmin:         boolean;         // === isAdministrator
  canManage:       boolean;         // isOwner || isAdministrator — org-management gate
  canWrite:        boolean;         // org-scoped owner|administrator|developer (excludes read_only and project scope)
}

function normalizeRole(raw: string | null | undefined): OrgRole | null {
  switch (raw) {
    case "owner":         return "owner";
    case "administrator": return "administrator";
    case "admin":         return "administrator"; // legacy
    case "developer":     return "developer";
    case "read_only":     return "read_only";
    case "member":        return "developer";      // legacy
    case null:
    case undefined:       return null;             // project-scoped (role lives per-project)
    default:              return "read_only";      // unknown → least privilege
  }
}

export function hasRole(role: OrgRole | null, allowed: OrgRole[]): boolean {
  return role !== null && allowed.includes(role);
}

interface RequireAuthOptions {
  /** If provided, the caller's org-wide role must be one of these or 403 is returned. */
  roles?: OrgRole[];
}

/**
 * Resolve the authenticated user, their active org, scope, and role.
 * Returns an AuthContext on success, or a NextResponse (401/403) on failure.
 *
 * Usage:
 *   const ctx = await requireAuth();
 *   if (ctx instanceof NextResponse) return ctx;
 *   if (!ctx.canManage) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
 */
export async function requireAuth(
  options?: RequireAuthOptions,
): Promise<AuthContext | NextResponse> {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members")
    .select("role, scope_type")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string | null; scope_type: string | null } | null };

  const scopeType: ScopeType = memberRow?.scope_type === "project" ? "project" : "organization";
  const role = normalizeRole(memberRow?.role);

  // The { roles } gate checks the ORG-WIDE role; project-scoped callers (role null)
  // never satisfy it — they reach project routes through per-project checks instead.
  if (options?.roles && (role === null || !options.roles.includes(role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isOwner         = scopeType === "organization" && role === "owner";
  const isAdministrator = scopeType === "organization" && role === "administrator";
  const isDeveloper     = scopeType === "organization" && role === "developer";
  const isReadOnly      = scopeType === "organization" && role === "read_only";

  return {
    user,
    orgId:           member.org_id,
    scopeType,
    role,
    isOwner,
    isAdministrator,
    isDeveloper,
    isReadOnly,
    isAdmin:         isAdministrator,
    canManage:       isOwner || isAdministrator,
    canWrite:        isOwner || isAdministrator || isDeveloper,
  };
}
