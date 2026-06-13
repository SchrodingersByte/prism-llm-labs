import {
  LayoutDashboard, FolderKanban, Users, Plug, CreditCard, Settings,
  Eye, BarChart3, KeyRound, ShieldCheck, ShieldHalf, type LucideIcon,
} from "lucide-react";

/** Mirrors OrgRole in lib/supabase/auth.ts (kept local so client nav code has no server import). */
export type NavRole = "owner" | "administrator" | "developer" | "read_only";

/** Org-tier (top-level) navigation — management + aggregate. `roles` omitted = all roles. */
export interface NavLink { href: string; label: string; icon: LucideIcon; exact?: boolean; roles?: NavRole[] }

export const ORG_NAV: NavLink[] = [
  { href: "/dashboard",              label: "Overview",     icon: LayoutDashboard, exact: true },
  { href: "/dashboard/projects",     label: "Projects",     icon: FolderKanban },
  { href: "/dashboard/teams",        label: "Teams",        icon: Users,      roles: ["owner", "administrator"] },
  { href: "/dashboard/integrations", label: "Integrations", icon: Plug,       roles: ["owner", "administrator"] },
  { href: "/dashboard/billing",      label: "Billing",      icon: CreditCard, roles: ["owner", "administrator"] },
  { href: "/dashboard/settings",     label: "Settings",     icon: Settings,   roles: ["owner", "administrator"] },
];

/** Project-tier navigation. `seg` is the path segment under /projects/[id]. */
export interface ProjectSection {
  seg: string;
  label: string;
  icon: LucideIcon;
  roles?: NavRole[];
  sub?: { seg: string; label: string }[];
}

export const PROJECT_NAV: ProjectSection[] = [
  { seg: "",              label: "Overview",      icon: LayoutDashboard },
  { seg: "observability", label: "Observability", icon: Eye, sub: [
      { seg: "logs", label: "Logs" }, { seg: "sessions", label: "Sessions" },
      { seg: "traces", label: "Traces" }, { seg: "agents", label: "Agents" },
    ] },
  { seg: "spend",         label: "Spend",         icon: BarChart3 },
  { seg: "keys",          label: "API Keys",      icon: KeyRound, sub: [
      { seg: "", label: "Keys" }, { seg: "caps", label: "Caps" }, { seg: "requests", label: "Requests" },
    ] },
  { seg: "enforcement",   label: "Enforcement",   icon: ShieldCheck, roles: ["owner", "administrator"] },
  { seg: "governance",    label: "Governance",    icon: ShieldHalf,  roles: ["owner", "administrator"] },
  { seg: "settings",      label: "Settings",      icon: Settings,    roles: ["owner", "administrator"] },
];

/** True if a role may see a nav item (no `roles` = visible to all). */
export function canSee(role: NavRole, item: { roles?: NavRole[] }): boolean {
  return !item.roles || item.roles.includes(role);
}

export function projectHref(id: string, seg: string, sub?: string): string {
  let h = `/dashboard/projects/${id}`;
  if (seg) h += `/${seg}`;
  if (sub) h += `/${sub}`;
  return h;
}

/**
 * Detect the project tier and extract { id, section, sub } from a pathname.
 * Returns null for org-tier paths (incl. the /dashboard/projects grid itself).
 */
export function parseProjectPath(pathname: string): { id: string; section: string; sub: string } | null {
  const m = pathname.match(/^\/dashboard\/projects\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/);
  if (!m || !m[1]) return null;
  return { id: m[1], section: m[2] ?? "", sub: m[3] ?? "" };
}
