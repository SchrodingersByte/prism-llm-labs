/**
 * Chargeback report data aggregator.
 *
 * Pulls vendor spend, cost center breakdown, and project spend from Tinybird
 * and computes a prior-period comparison for month-over-month context.
 */

import {
  getSpendByProvider,
  getSpendByCostCenter,
  getSpendByProject,
  type ProviderSpend,
  type CostCenterSpend,
  type ProjectSpend,
} from "@/lib/tinybird/queries";

export interface ChargebackReportData {
  org_name:     string;
  period:       { from: string; to: string; label: string };
  generated_at: string;
  summary: {
    total_cost_usd:  number;
    provider_count:  number;
    request_count:   number;
    mom_delta_pct:   number | null;  // month-over-month % change
  };
  by_vendor:       ProviderSpend[];
  by_cost_center:  CostCenterSpend[];
  by_project:      ProjectSpend[];
  prior_period?:   { total_cost_usd: number };
}

/** Shift a date string by N months. Format: "YYYY-MM-DD HH:MM:SS" */
function shiftMonth(dateStr: string, months: number): string {
  const d = new Date(dateStr.replace(" ", "T") + "Z");
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export async function buildChargebackReport(
  orgId:   string,
  orgName: string,
  from:    string,
  to:      string,
): Promise<ChargebackReportData> {
  const priorFrom = shiftMonth(from, -1);
  const priorTo   = shiftMonth(to,   -1);

  const [byVendor, byCostCenter, byProject, priorVendor] = await Promise.all([
    getSpendByProvider(orgId, from, to),
    getSpendByCostCenter(orgId, from, to),
    getSpendByProject(orgId, from, to),
    getSpendByProvider(orgId, priorFrom, priorTo).catch(() => [] as ProviderSpend[]),
  ]);

  const totalCost    = byVendor.reduce((s, v) => s + v.total_cost_usd, 0);
  const totalReqs    = byVendor.reduce((s, v) => s + v.total_requests, 0);
  const priorTotal   = priorVendor.reduce((s, v) => s + v.total_cost_usd, 0);
  const momDeltaPct  = priorTotal > 0 ? ((totalCost - priorTotal) / priorTotal) * 100 : null;

  // Human-readable period label
  const fromDate = new Date(from.replace(" ", "T") + "Z");
  const toDate   = new Date(to.replace(" ", "T") + "Z");
  const label    = `${fromDate.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}`;

  return {
    org_name:     orgName,
    period:       { from, to, label },
    generated_at: new Date().toISOString(),
    summary: {
      total_cost_usd:  totalCost,
      provider_count:  byVendor.length,
      request_count:   totalReqs,
      mom_delta_pct:   momDeltaPct,
    },
    by_vendor:      byVendor,
    by_cost_center: byCostCenter,
    by_project:     byProject,
    prior_period:   priorTotal > 0 ? { total_cost_usd: priorTotal } : undefined,
  };
}
