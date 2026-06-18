import {
  LayoutDashboard, Banknote, Cpu, Calculator, BarChart3,
  ShieldCheck, FileText, FlaskConical, Radar, Bot,
  Activity, ScrollText, Network,
  FolderKanban, Bell, GraduationCap, Users2, Eye,
  KeyRound, Plug, CreditCard, FileCheck2, Lock, Building2, Users, ShieldHalf,
  Settings as SettingsIcon, type LucideIcon,
} from "lucide-react";

/** Mirrors OrgRole in lib/supabase/auth.ts (kept local so client nav code has no server import). */
export type NavRole = "owner" | "administrator" | "developer" | "read_only";

/** A dynamic badge source resolved client-side (e.g. firing alert count). */
export type BadgeKey = "alerts";

/** A single nav destination. `roles` omitted = visible to all roles. */
export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
  roles?: NavRole[];
  badge?: BadgeKey;
}

/** A collapsible section of the org sidebar. */
export interface NavGroup {
  label: string;
  items: NavLink[];
}

/* ─────────────────────────────────────────────────────────────────────────
   ORG TIER — grouped sidebar (2 levels: group → item). 3rd-level sub-routes
   are NOT here; they render as PageTabs (see the *_TABS exports below).
   Settings + Account live in their own area (gear / avatar), not the sidebar.
   ──────────────────────────────────────────────────────────────────────── */
export const ORG_GROUPS: NavGroup[] = [
  {
    label: "Analytics",
    items: [
      { href: "/dashboard",                label: "Overview",       icon: LayoutDashboard, exact: true },
      { href: "/dashboard/finops",         label: "FinOps",         icon: Banknote },
      { href: "/dashboard/models",         label: "Models",         icon: Cpu },
      { href: "/dashboard/unit-economics", label: "Unit Economics", icon: Calculator },
      { href: "/dashboard/spend",          label: "Spend",          icon: BarChart3 },
    ],
  },
  {
    label: "Quality & Intel",
    items: [
      { href: "/dashboard/quality",   label: "Quality",   icon: ShieldCheck },
      { href: "/dashboard/prompts",   label: "Prompts",   icon: FileText },
      { href: "/dashboard/workbench", label: "Workbench", icon: FlaskConical },
      { href: "/dashboard/drift",     label: "Drift",     icon: Radar },
      { href: "/dashboard/copilot",   label: "Copilot",   icon: Bot },
    ],
  },
  {
    label: "Observability",
    items: [
      { href: "/dashboard/sessions", label: "Sessions", icon: Activity },
      { href: "/dashboard/logs",     label: "Logs",     icon: ScrollText },
      { href: "/dashboard/agents",   label: "Agents",   icon: Network },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/dashboard/projects",  label: "Projects",  icon: FolderKanban },
      { href: "/dashboard/alerts",    label: "Alerts",    icon: Bell, badge: "alerts" },
      { href: "/dashboard/training",  label: "Training",  icon: GraduationCap },
      { href: "/dashboard/customers", label: "Customers", icon: Users2 },
      { href: "/dashboard/shadow-it", label: "Shadow IT", icon: Eye, roles: ["owner", "administrator"] },
    ],
  },
];

/** Flat list of every org nav link — used by the command palette / search. */
export const ORG_NAV: NavLink[] = ORG_GROUPS.flatMap((g) => g.items);

/* ── Settings area (separate, owner/admin) — rendered as tabs ─────────────── */
export const SETTINGS_NAV: NavLink[] = [
  { href: "/dashboard/settings/access",       label: "Access",       icon: KeyRound },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/settings/billing",      label: "Billing",      icon: CreditCard },
  { href: "/dashboard/settings/compliance",   label: "Compliance",   icon: FileCheck2 },
  { href: "/dashboard/settings/privacy",      label: "Privacy",      icon: Lock },
];

/* ── Account area (enterprise) — rendered as tabs ─────────────────────────── */
export const ACCOUNT_NAV: NavLink[] = [
  { href: "/dashboard/account/overview", label: "Organization", icon: Building2 },
  { href: "/dashboard/account/members",  label: "Members",      icon: Users },
  { href: "/dashboard/account/sso",      label: "SSO",          icon: ShieldHalf },
];

/* ─────────────────────────────────────────────────────────────────────────
   PAGE TABS — 3rd-level routes surfaced as top-of-page tabs (see PageTabs).
   ──────────────────────────────────────────────────────────────────────── */
export interface TabItem { href: string; label: string; exact?: boolean }

export const SPEND_TABS: TabItem[] = [
  { href: "/dashboard/spend/cost",           label: "Cost" },
  { href: "/dashboard/spend/anomalies",      label: "Anomalies" },
  { href: "/dashboard/spend/attribution",    label: "Attribution" },
  { href: "/dashboard/spend/billing",        label: "Billing" },
  { href: "/dashboard/spend/infrastructure", label: "Infrastructure" },
  { href: "/dashboard/spend/training",       label: "Training" },
];

export const QUALITY_TABS: TabItem[] = [
  { href: "/dashboard/quality",             label: "Overview", exact: true },
  { href: "/dashboard/quality/annotations", label: "Annotations" },
  { href: "/dashboard/quality/errors",      label: "Errors" },
];

export const WORKBENCH_TABS: TabItem[] = [
  { href: "/dashboard/workbench/evals", label: "Evals" },
  { href: "/dashboard/workbench/arena", label: "Arena" },
];

export const MODELS_TABS: TabItem[] = [
  { href: "/dashboard/models",         label: "Overview", exact: true },
  { href: "/dashboard/models/compare", label: "Compare" },
];

export const SETTINGS_TABS: TabItem[] = SETTINGS_NAV.map((n) => ({ href: n.href, label: n.label }));
export const ACCOUNT_TABS: TabItem[] = ACCOUNT_NAV.map((n) => ({ href: n.href, label: n.label }));

/* ─────────────────────────────────────────────────────────────────────────
   PROJECT TIER — shown when inside /dashboard/projects/[id]. Items with `sub`
   render those sub-routes as PageTabs inside the section.
   ──────────────────────────────────────────────────────────────────────── */
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
  { seg: "quality",       label: "Quality",       icon: ShieldCheck },
  { seg: "prompts",       label: "Prompts",       icon: FileText },
  { seg: "spend",         label: "Spend",         icon: BarChart3 },
  { seg: "keys",          label: "API Keys",      icon: KeyRound, sub: [
      { seg: "", label: "Keys" }, { seg: "caps", label: "Caps" }, { seg: "requests", label: "Requests" },
    ] },
  { seg: "enforcement",   label: "Enforcement",   icon: ShieldCheck, roles: ["owner", "administrator"] },
  { seg: "governance",    label: "Governance",    icon: ShieldHalf,  roles: ["owner", "administrator"] },
  { seg: "settings",      label: "Settings",      icon: SettingsIcon, roles: ["owner", "administrator"] },
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

/** Tab set for a project section that has sub-routes (for PageTabs). */
export function projectTabs(id: string, seg: string): TabItem[] {
  const section = PROJECT_NAV.find((s) => s.seg === seg);
  if (!section?.sub) return [];
  return section.sub.map((s) => ({
    href: projectHref(id, seg, s.seg || undefined),
    label: s.label,
    exact: s.seg === "",
  }));
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
