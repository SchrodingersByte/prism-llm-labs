/**
 * Starter layouts for the Command Center. Selecting one seeds the user's widget
 * list; they then tweak freely. Templates are role-agnostic seeds — the canvas
 * still enforces each widget's `roles`, so a manager-only widget in a template
 * simply doesn't render for a developer.
 */
export interface DashboardTemplate {
  id: string;
  label: string;
  ids: string[];
}

const KPIS = ["kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors"];

export const TEMPLATES: DashboardTemplate[] = [
  { id: "finance", label: "Finance", ids: [...KPIS, "spend-trend", "spend-by-provider", "budget-tracker", "cost-by-feature", "projects"] },
  { id: "eng",     label: "Eng",     ids: [...KPIS, "spend-trend", "top-models", "provider-health", "sessions-p90"] },
  { id: "product", label: "Product", ids: [...KPIS, "cost-by-feature", "sessions-p90", "spend-trend", "projects"] },
  { id: "exec",    label: "Exec",    ids: [...KPIS, "spend-trend", "spend-by-provider", "budget-tracker", "projects"] },
  { id: "sales",   label: "Sales",   ids: [...KPIS, "projects", "spend-by-provider", "cost-by-feature"] },
  { id: "ds",      label: "Data Science", ids: [...KPIS, "top-models", "efficiency", "sessions-p90", "spend-trend"] },
];
