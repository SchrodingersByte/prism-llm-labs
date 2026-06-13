/**
 * All feature keys used for sidebar nav items.
 * Lives in a plain (non-client) module so dashboard/layout.tsx can
 * import it without crossing the "use client" boundary in Sidebar.tsx.
 */
export const ALL_NAV_FEATURE_KEYS: string[] = [
  // Section-level (whole pages)
  "finops",
  "models_dashboard",
  "unit_economics",
  "agents",
  "sessions",
  "evals",         // Eval framework + Model Arena
  "projects",
  "team_management",
  "training_runs",
  "arena",         // kept for backward compat (arena page still accessible)
  "engine",        // Model Intelligence Engine (replaces arena in nav)
  "logs",
  "compliance_hub",
  "multi_tenant_billing",
];
