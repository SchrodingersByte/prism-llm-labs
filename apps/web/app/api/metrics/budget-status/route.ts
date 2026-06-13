/**
 * GET /api/metrics/budget-status
 *
 * Returns org-level budget utilization and month-end projection.
 * Exposes the gateway budget logic (resolveOrgBudget) to the dashboard UI.
 */

import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getSpend } from "@/lib/upstash/redis";
import { resolveOrgBudget } from "@/lib/gateway/budget";
import { getOverviewMetrics, getTimeseriesDaily } from "@/lib/tinybird/queries";

function monthStart() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01 00:00:00`;
}
function today() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Resolve org-level budget limit
  const { limitUsd, enforceHard } = await resolveOrgBudget(admin, member.org_id, "");

  // 7 days ago for rolling burn rate
  function sevenDaysAgo() {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().replace("T", " ").slice(0, 19);
  }

  // Current month spend from Redis (fast, approximate) + Tinybird (accurate)
  const [redisSpend, tbMetrics, dailySeries] = await Promise.all([
    getSpend(member.org_id, "default").catch(() => 0),
    getOverviewMetrics(member.org_id, monthStart(), today()),
    getTimeseriesDaily(member.org_id, "", sevenDaysAgo(), today()).catch(() => []),
  ]);

  const spendUsd = tbMetrics?.total_cost_usd ?? redisSpend ?? 0;

  // Budget utilization math
  const now             = new Date();
  const daysInMonth     = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed     = now.getDate();
  const daysRemaining   = daysInMonth - daysElapsed;
  const dailyBurnRate   = daysElapsed > 0 ? spendUsd / daysElapsed : 0;

  // 7-day rolling burn rate (smoother — uses recent daily data)
  const last7 = (dailySeries ?? []).slice(-7);
  const rolling7dBurnRate = last7.length > 0
    ? last7.reduce((s, p) => s + p.cost_usd, 0) / last7.length
    : dailyBurnRate;

  const projectedMonthEnd = rolling7dBurnRate * daysInMonth;
  const utilizationPct  = limitUsd && limitUsd > 0 ? (spendUsd / limitUsd) * 100 : null;
  const projectedOverage = limitUsd && projectedMonthEnd > limitUsd
    ? projectedMonthEnd - limitUsd : 0;

  // Budget status classification
  const budgetStatus: "on_track" | "at_risk" | "over_budget" =
    utilizationPct !== null && utilizationPct >= 100 ? "over_budget"
    : limitUsd && projectedMonthEnd > limitUsd * 0.9   ? "at_risk"
    : "on_track";

  // Forecast series: one point per day this month (past = actual, future = projected)
  const monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
  const actualByDate   = new Map<string, number>();
  for (const p of (dailySeries ?? [])) {
    const dateKey = p.date.slice(0, 10);
    actualByDate.set(dateKey, (actualByDate.get(dateKey) ?? 0) + p.cost_usd);
  }

  const forecastSeries: Array<{ date: string; projected_cumulative: number; is_actual: boolean }> = [];
  let runningActual = 0;
  for (let d = 0; d < daysInMonth; d++) {
    const dayDate  = new Date(monthStartDate.getTime() + d * 86_400_000);
    const dateStr  = dayDate.toISOString().slice(0, 10);
    const isPast   = dayDate <= now;
    if (isPast) {
      runningActual += actualByDate.get(dateStr) ?? 0;
      forecastSeries.push({ date: dateStr, projected_cumulative: runningActual, is_actual: true });
    } else {
      forecastSeries.push({
        date: dateStr,
        projected_cumulative: runningActual + rolling7dBurnRate * (d - daysElapsed + 1),
        is_actual: false,
      });
    }
  }

  // Per-project budgets
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: projectBudgets } = await (admin as any)
    .from("budgets")
    .select("project_id, amount_usd, enforce_hard_cap, projects(name)")
    .eq("org_id", member.org_id)
    .not("project_id", "is", null)
    .eq("period", "monthly") as {
      data: Array<{
        project_id: string;
        amount_usd: number;
        enforce_hard_cap: boolean;
        projects: { name: string } | null;
      }> | null
    };

  return NextResponse.json({
    spend_usd:             spendUsd,
    limit_usd:             limitUsd,
    enforce_hard:          enforceHard,
    utilization_pct:       utilizationPct,
    days_elapsed:          daysElapsed,
    days_remaining:        daysRemaining,
    days_in_month:         daysInMonth,
    daily_burn_rate:       dailyBurnRate,
    rolling_7d_burn_rate:  rolling7dBurnRate,
    projected_month_end:   projectedMonthEnd,
    projected_overage:     projectedOverage,
    budget_status:         budgetStatus,
    forecast_series:       forecastSeries,
    project_budgets:     (projectBudgets ?? []).map(b => ({
      project_id:   b.project_id,
      project_name: b.projects?.name ?? b.project_id,
      limit_usd:    b.amount_usd,
      enforce_hard: b.enforce_hard_cap,
    })),
  });
}
