/**
 * Shared budget resolution for the gateway soft-cap check.
 * Mirrors the logic in /api/budget/check/route.ts without the HTTP overhead.
 */

import { getSpend } from "@/lib/upstash/redis";

interface BudgetRow { amount_usd: number; enforce_hard_cap: boolean }
interface ProjectRow { id: string; monthly_budget_usd: number | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveOrgBudget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:  any,
  orgId:     string,
  projectId: string,
  provider?: string,
): Promise<{ limitUsd: number | null; enforceHard: boolean }> {
  // Provider-level budget is the most specific scope — it caps spend for a
  // single upstream provider regardless of project.
  if (provider) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: provBudget } = await (supabase as any)
      .from("budgets")
      .select("amount_usd, enforce_hard_cap")
      .eq("org_id", orgId)
      .eq("provider", provider)
      .is("project_id", null)
      .is("user_id", null)
      .eq("period", "monthly")
      .limit(1)
      .maybeSingle() as { data: BudgetRow | null };
    if (provBudget) return { limitUsd: provBudget.amount_usd, enforceHard: provBudget.enforce_hard_cap };
  }

  if (projectId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (supabase as any)
      .from("projects")
      .select("id, monthly_budget_usd")
      .eq("id", projectId)
      .eq("org_id", orgId)
      .maybeSingle() as { data: ProjectRow | null };

    if (proj) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabase as any)
        .from("budgets")
        .select("amount_usd, enforce_hard_cap")
        .eq("org_id", orgId)
        .eq("project_id", proj.id)
        .is("provider", null)
        .eq("period", "monthly")
        .limit(1)
        .maybeSingle() as { data: BudgetRow | null };

      if (row) return { limitUsd: row.amount_usd, enforceHard: row.enforce_hard_cap };
      if (proj.monthly_budget_usd != null) {
        return { limitUsd: proj.monthly_budget_usd, enforceHard: false };
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: orgBudget } = await (supabase as any)
    .from("budgets")
    .select("amount_usd, enforce_hard_cap")
    .eq("org_id", orgId)
    .is("project_id", null)
    .is("user_id", null)
    .is("provider", null)
    .eq("period", "monthly")
    .limit(1)
    .maybeSingle() as { data: BudgetRow | null };

  if (orgBudget) return { limitUsd: orgBudget.amount_usd, enforceHard: orgBudget.enforce_hard_cap };
  return { limitUsd: null, enforceHard: false };
}

/**
 * Returns budget status for the gateway soft-cap check.
 * status = "ok" | "soft_cap_hit" | "hard_cap_exceeded"
 */
export async function getGatewaySoftCapStatus(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase:    any,
  orgId:       string,
  projectId:   string,
  softCapPct:  number,
  provider?:   string,
): Promise<{ status: "ok" | "soft_cap_hit" | "hard_cap_exceeded"; spendPct: number }> {
  try {
    // getSpend (Redis) and resolveOrgBudget (Supabase) are independent — run in parallel.
    const [spend, { limitUsd, enforceHard }] = await Promise.all([
      getSpend(orgId, projectId || "default"),
      resolveOrgBudget(supabase, orgId, projectId, provider),
    ]);
    if (limitUsd == null || limitUsd <= 0) return { status: "ok", spendPct: 0 };

    const pct = (spend / limitUsd) * 100;
    if (enforceHard && spend >= limitUsd) return { status: "hard_cap_exceeded", spendPct: pct };
    if (pct >= softCapPct) return { status: "soft_cap_hit", spendPct: pct };
    return { status: "ok", spendPct: pct };
  } catch {
    return { status: "ok", spendPct: 0 }; // fail open
  }
}
