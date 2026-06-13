"use client";

import { DollarSign, Activity, Cpu, AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/patterns/KpiCard";
import { ChartCard } from "@/components/patterns/ChartCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { BarList } from "@/components/charts/BarList";
import { Skeleton } from "@/components/ui/skeleton";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchOverview, fetchSpendByModel, fetchTimeseriesDaily, fetchSpendByProject } from "@/lib/api/metrics";
import { formatCost } from "@/lib/utils";
import type { Scope } from "@/lib/scope";
import type { NavRole } from "@/lib/nav";

export interface WidgetProps { scope: Scope; projectId?: string }
export type WidgetSize = "sm" | "md" | "lg";

export interface WidgetDef {
  id: string;
  title: string;
  description?: string;
  category: "kpi" | "spend" | "efficiency";
  size: WidgetSize;
  roles?: NavRole[];
  Component: React.ComponentType<WidgetProps>;
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;

function NoData() {
  return <div className="flex h-[140px] items-center justify-center text-xs text-muted-foreground">No data in this range</div>;
}

// ── KPI widgets — all share the "overview" source, so they dedupe to one request ──

function SpendKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview", scope, projectId, fetchOverview);
  return <KpiCard label="Total spend" color="indigo" icon={DollarSign}
    value={isLoading ? <Skeleton className="h-7 w-24" /> : formatCost(data?.total_cost_usd ?? 0)} />;
}
function RequestsKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview", scope, projectId, fetchOverview);
  return <KpiCard label="Requests" color="cyan" icon={Activity}
    value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(data?.total_requests ?? 0)} />;
}
function TokensKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview", scope, projectId, fetchOverview);
  const tokens = (data?.total_input_tokens ?? 0) + (data?.total_output_tokens ?? 0);
  return <KpiCard label="Tokens" color="violet" icon={Cpu}
    value={isLoading ? <Skeleton className="h-7 w-20" /> : fmtNum(tokens)} />;
}
function ErrorRateKpi({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("overview", scope, projectId, fetchOverview);
  return <KpiCard label="Error rate" color="amber" icon={AlertTriangle}
    value={isLoading ? <Skeleton className="h-7 w-16" /> : fmtPct(data?.error_rate ?? 0)} />;
}

// ── Chart widgets ──

function SpendTrend({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("timeseries", scope, projectId, fetchTimeseriesDaily);
  return (
    <ChartCard title="Spend over time">
      {isLoading ? <Skeleton className="h-[180px] w-full" />
        : !data || data.length === 0 ? <NoData />
        : <AreaTrend data={data as unknown as Record<string, unknown>[]} xKey="date" yKey="cost_usd" height={180}
            valueFormatter={(v) => `$${(v / 1000).toFixed(1)}k`} />}
    </ChartCard>
  );
}

function TopModels({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("models", scope, projectId, fetchSpendByModel);
  const items = (data ?? []).slice(0, 6).map((m) => ({ label: m.model, value: m.total_cost_usd }));
  return (
    <ChartCard title="Top models">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

function SpendByProjectWidget({ scope, projectId }: WidgetProps) {
  const { data, isLoading } = useWidgetData("projects", scope, projectId, fetchSpendByProject);
  const items = (data ?? []).slice(0, 6).map((p) => ({ label: p.project_name || p.project_id, value: p.cost_usd }));
  return (
    <ChartCard title="Spend by project">
      {isLoading ? <Skeleton className="h-32 w-full" /> : items.length === 0 ? <NoData /> : <BarList items={items} valueFormatter={formatCost} />}
    </ChartCard>
  );
}

// ── Registry ──

export const REGISTRY: WidgetDef[] = [
  { id: "kpi-spend",        title: "Total spend",      category: "kpi",   size: "sm", Component: SpendKpi },
  { id: "kpi-requests",     title: "Requests",         category: "kpi",   size: "sm", Component: RequestsKpi },
  { id: "kpi-tokens",       title: "Tokens",           category: "kpi",   size: "sm", Component: TokensKpi },
  { id: "kpi-errors",       title: "Error rate",       category: "kpi",   size: "sm", Component: ErrorRateKpi },
  { id: "spend-trend",      title: "Spend over time",  category: "spend", size: "lg", Component: SpendTrend },
  { id: "top-models",       title: "Top models",       category: "spend", size: "md", Component: TopModels },
  { id: "spend-by-project", title: "Spend by project", category: "spend", size: "md", Component: SpendByProjectWidget },
];

const BY_ID = new Map(REGISTRY.map((w) => [w.id, w]));
export function getWidget(id: string): WidgetDef | undefined {
  return BY_ID.get(id);
}

export const DEFAULT_ORG_VIEW = [
  "kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors",
  "spend-trend", "top-models", "spend-by-project",
];
export const DEFAULT_PROJECT_VIEW = [
  "kpi-spend", "kpi-requests", "kpi-tokens", "kpi-errors",
  "spend-trend", "top-models",
];
