"use client";

import { useEffect, useMemo, useState } from "react";
import {
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Tooltip, ResponsiveContainer,
} from "recharts";
import { Check, Cpu } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchSpendByModel } from "@/lib/api/metrics";
import { VIZ, CHART_GRID, AXIS_TICK_FILL, tooltipContentStyle, tooltipLabelStyle } from "@/lib/charts/theme";
import { cn, formatCost } from "@/lib/utils";
import type { ModelSpend } from "@/lib/tinybird/queries";

const MAX = 3;
const COLORS = [VIZ.gold, VIZ.sky, VIZ.violet];

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const idOf = (m: ModelSpend) => `${m.provider}:${m.model}`;

// Radar axes — each normalized 0–100 across all models (min-max), so the strongest
// model on an axis hits 100. Latency and error rate are inverted (lower is better).
const AXES: { key: string; label: string; get: (m: ModelSpend) => number; higher: boolean }[] = [
  { key: "cost",  label: "Cost-eff",    get: (m) => m.tokens_per_dollar,   higher: true },
  { key: "cache", label: "Cache hit",   get: (m) => m.cache_hit_rate,      higher: true },
  { key: "speed", label: "Speed",       get: (m) => m.avg_latency_ms,      higher: false },
  { key: "rel",   label: "Reliability", get: (m) => m.error_rate,          higher: false },
  { key: "thru",  label: "Throughput",  get: (m) => m.requests,            higher: true },
  { key: "out",   label: "Output ratio", get: (m) => m.output_input_ratio, higher: true },
];

export function CompareModels() {
  const { scope } = useScope();
  const { data, isLoading } = useWidgetData("models", scope, undefined, fetchSpendByModel);
  const rows = useMemo(() => data ?? [], [data]);
  const [selected, setSelected] = useState<string[]>([]);

  // Default to the top 3 models by spend once data arrives.
  useEffect(() => {
    if (selected.length === 0 && rows.length > 0) setSelected(rows.slice(0, MAX).map(idOf));
  }, [rows, selected.length]);

  const bounds = useMemo(() => {
    const b: Record<string, { min: number; max: number }> = {};
    for (const ax of AXES) {
      const vals = rows.map(ax.get);
      b[ax.key] = { min: Math.min(...vals, 0), max: Math.max(...vals, 0) };
    }
    return b;
  }, [rows]);

  function norm(m: ModelSpend, ax: typeof AXES[number]): number {
    const { min, max } = bounds[ax.key]!;
    if (max === min) return 100;
    const t = (ax.get(m) - min) / (max - min);
    return Math.round((ax.higher ? t : 1 - t) * 100);
  }

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX ? [...prev, id] : prev,
    );
  }

  const chosen = selected.map((id) => rows.find((r) => idOf(r) === id)).filter((m): m is ModelSpend => !!m);
  const radarData = AXES.map((ax) => {
    const point: Record<string, string | number> = { axis: ax.label };
    chosen.forEach((m, i) => { point[`m${i}`] = norm(m, ax); });
    return point;
  });

  if (isLoading) return <div className="p-5"><Skeleton className="h-80 w-full" /></div>;
  if (rows.length === 0) {
    return <div className="p-5"><EmptyState icon={Cpu} title="No models to compare" description="Once you've sent traffic through a few models, select up to three here to compare them side by side." /></div>;
  }

  const attrs: { label: string; fmt: (m: ModelSpend) => string }[] = [
    { label: "Provider",    fmt: (m) => m.provider },
    { label: "Spend",       fmt: (m) => formatCost(m.total_cost_usd) },
    { label: "Requests",    fmt: (m) => fmtNum(m.requests) },
    { label: "Total tokens", fmt: (m) => fmtNum(m.input_tokens + m.output_tokens) },
    { label: "$ / request", fmt: (m) => `$${m.avg_cost_per_request.toFixed(3)}` },
    { label: "Cache hit",   fmt: (m) => `${(m.cache_hit_rate * 100).toFixed(0)}%` },
    { label: "Error rate",  fmt: (m) => `${(m.error_rate * 100).toFixed(1)}%` },
    { label: "Avg latency", fmt: (m) => fmtMs(m.avg_latency_ms) },
  ];

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      {/* Left — selectable model list */}
      <div className="col-span-12 lg:col-span-4">
        <ChartCard title="Select models" subtitle={`${chosen.length}/${MAX} selected`} contentClassName="p-0">
          <div className="dash-scroll max-h-[520px] overflow-y-auto">
            {rows.map((m) => {
              const id = idOf(m);
              const idx = selected.indexOf(id);
              const isSel = idx >= 0;
              const atCap = selected.length >= MAX && !isSel;
              return (
                <button
                  key={id}
                  onClick={() => toggle(id)}
                  disabled={atCap}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors last:border-0",
                    isSel ? "bg-accent" : atCap ? "opacity-40" : "hover:bg-muted",
                  )}
                >
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                    style={isSel ? { background: COLORS[idx], borderColor: COLORS[idx] } : { borderColor: "hsl(var(--border))" }}
                  >
                    {isSel && <Check className="h-3 w-3 text-[hsl(var(--primary-foreground))]" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{m.model}</span>
                    <span className="block truncate text-xs text-muted-foreground">{m.provider}</span>
                  </span>
                  <span className="tabular shrink-0 text-xs text-muted-foreground">{formatCost(m.total_cost_usd)}</span>
                </button>
              );
            })}
          </div>
        </ChartCard>
      </div>

      {/* Right — radar + core attributes */}
      <div className="col-span-12 space-y-3 lg:col-span-8">
        <ChartCard title="Attribute comparison" subtitle="normalized 0–100 across all models">
          {chosen.length === 0 ? (
            <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">Select a model to compare.</div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap gap-3">
                {chosen.map((m, i) => (
                  <span key={idOf(m)} className="flex items-center gap-1.5 text-xs">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS[i] }} />{m.model}
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke={CHART_GRID} />
                  <PolarAngleAxis dataKey="axis" tick={{ fill: AXIS_TICK_FILL, fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  {chosen.map((m, i) => (
                    <Radar key={idOf(m)} name={m.model} dataKey={`m${i}`} stroke={COLORS[i]} fill={COLORS[i]} fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
                  ))}
                  <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} />
                </RadarChart>
              </ResponsiveContainer>
            </>
          )}
        </ChartCard>

        {chosen.length > 0 && (
          <ChartCard title="Core attributes">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Attribute</th>
                    {chosen.map((m, i) => (
                      <th key={idOf(m)} className="px-2 text-right font-normal">
                        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: COLORS[i] }} />{m.model}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attrs.map((a) => (
                    <tr key={a.label} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-muted-foreground">{a.label}</td>
                      {chosen.map((m) => <td key={idOf(m)} className="tabular px-2 text-right">{a.fmt(m)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}
      </div>
    </div>
  );
}
