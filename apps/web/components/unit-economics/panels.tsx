"use client";

import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { BarList } from "@/components/charts/BarList";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchUnitEconTags, fetchOutcomes, fetchSessionDistribution } from "@/lib/api/metrics";
import { cn, formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);

function PanelEmpty({ msg }: { msg: string }) {
  return <div className="flex h-[140px] items-center justify-center px-4 text-center text-xs text-muted-foreground">{msg}</div>;
}

export function UnitEconKpis() {
  const { scope } = useScope();
  const tags = useWidgetData("unit-tags", scope, undefined, fetchUnitEconTags);
  const out = useWidgetData("outcomes", scope, undefined, fetchOutcomes);
  const dist = useWidgetData("session-dist", scope, undefined, fetchSessionDistribution);

  const taggedCost = (tags.data?.features ?? []).reduce((s, f) => s + f.cost_usd, 0);
  const withOut = out.data?.with_outcomes ?? [];
  const totalCost = withOut.reduce((s, r) => s + r.total_cost_usd, 0);
  const totalSuccess = withOut.reduce((s, r) => s + r.successful_outcomes, 0);
  const totalValue = withOut.reduce((s, r) => s + r.total_value_usd, 0);
  const costPerSuccess = totalSuccess > 0 ? totalCost / totalSuccess : 0;
  const roi = totalCost > 0 ? totalValue / totalCost : 0;
  const loading = tags.isLoading || out.isLoading || dist.isLoading;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Tagged cost" color="gold" value={loading ? <Skeleton className="h-7 w-20" /> : formatCost(taggedCost)} />
      <KpiCard label="Cost / success" color="violet" value={loading ? <Skeleton className="h-7 w-16" /> : costPerSuccess > 0 ? formatCost(costPerSuccess) : "—"} />
      <KpiCard label="Overall ROI" color={roi >= 1 ? "emerald" : "coral"} value={loading ? <Skeleton className="h-7 w-14" /> : totalCost > 0 ? `${roi.toFixed(2)}×` : "—"} />
      <KpiCard label="Session P90" color="amber" value={loading ? <Skeleton className="h-7 w-16" /> : formatCost(dist.data?.p90_cost_usd ?? 0)} />
    </div>
  );
}

export function CostByFeature() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("unit-tags", scope, undefined, fetchUnitEconTags);
  const items = (data?.features ?? []).slice(0, 8).map((f) => ({ label: f.feature || "untagged", value: f.cost_usd }));
  return (
    <ChartCard title="Cost by feature" subtitle="x-prism-feature">
      {isLoading ? <Skeleton className="h-40 w-full" /> : items.length === 0 ? <PanelEmpty msg="No feature-tagged spend — set x-prism-feature on requests." /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

export function CostByAction() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("unit-tags", scope, undefined, fetchUnitEconTags);
  const items = (data?.actions ?? []).slice(0, 8).map((a) => ({ label: a.action || "untagged", value: a.cost_usd }));
  return (
    <ChartCard title="Cost by action" subtitle="x-prism-action">
      {isLoading ? <Skeleton className="h-40 w-full" /> : items.length === 0 ? <PanelEmpty msg="No action-tagged spend — set x-prism-action on requests." /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

export function RoiTable() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("outcomes", scope, undefined, fetchOutcomes);
  const rows = [...(data?.with_outcomes ?? [])].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  return (
    <ChartCard title="ROI by feature" subtitle="cost per successful outcome, value, and return">
      {isLoading ? <Skeleton className="h-48 w-full" />
        : rows.length === 0 ? <PanelEmpty msg="No outcomes recorded — report success/value via the SDK or /api/feedback to unlock ROI." />
        : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-1.5 text-left font-normal">Feature</th>
                  <th className="text-right font-normal">Cost</th>
                  <th className="text-right font-normal">Success</th>
                  <th className="text-right font-normal">Value</th>
                  <th className="text-right font-normal">$/success</th>
                  <th className="pl-3 text-right font-normal">ROI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feature_tag} className="border-b border-border/60 last:border-0">
                    <td className="py-2">{r.feature_tag || "untagged"}</td>
                    <td className="tabular text-right">{formatCost(r.total_cost_usd)}</td>
                    <td className="tabular text-right text-muted-foreground">{fmtNum(r.successful_outcomes)}</td>
                    <td className="tabular text-right text-muted-foreground">{formatCost(r.total_value_usd)}</td>
                    <td className="tabular text-right">{formatCost(r.actual_cost_per_success)}</td>
                    <td className={cn("tabular pl-3 text-right", r.roi_ratio >= 1 ? "positive" : "signal")}>{r.roi_ratio.toFixed(2)}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
    </ChartCard>
  );
}

export function SessionPercentiles() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("session-dist", scope, undefined, fetchSessionDistribution);
  const d = data;
  return (
    <ChartCard title="Session cost" subtitle="per-session percentiles">
      {isLoading ? <Skeleton className="h-48 w-full" />
        : !d || d.session_count === 0 ? <PanelEmpty msg="No sessions in this range." />
        : <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {([["P50", d.p50_cost_usd], ["P90", d.p90_cost_usd], ["P99", d.p99_cost_usd]] as const).map(([label, v]) => (
                <div key={label} className="rounded-md bg-muted/50 p-2">
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="tabular mt-0.5 text-base font-medium">{formatCost(v)}</div>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{fmtNum(d.session_count)} sessions</span>
              <span>{d.avg_calls_per_session.toFixed(1)} calls · {fmtNum(d.avg_tokens_per_session)} tok / session</span>
            </div>
          </div>}
    </ChartCard>
  );
}
