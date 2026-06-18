"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Network } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { DataTable } from "@/components/patterns/DataTable";
import { Skeleton } from "@/components/ui/skeleton";
import { useScope } from "@/hooks/useScope";
import { useWidgetData } from "@/hooks/useWidgetData";
import { fetchMcpOverview, fetchMcpServers, fetchMcpTools } from "@/lib/api/metrics";
import { useProject } from "@/components/layout/project-context";
import { cn, formatCost } from "@/lib/utils";
import type { McpToolSpend } from "@/lib/tinybird/queries";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

const toolColumns: ColumnDef<McpToolSpend>[] = [
  { accessorKey: "tool_name", header: "Tool", cell: ({ row }) => <span><span className="font-medium">{row.original.tool_name}</span><span className="ml-1.5 text-xs text-muted-foreground">{row.original.mcp_server_name}</span></span> },
  { accessorKey: "total_calls", header: "Calls", cell: ({ getValue }) => <span className="tabular">{fmtNum(getValue<number>())}</span> },
  { accessorKey: "error_rate", header: "Err", cell: ({ getValue }) => { const v = getValue<number>(); return <span className={cn("tabular", v > 0.01 && "signal")}>{(v * 100).toFixed(1)}%</span>; } },
  { accessorKey: "cost_usd", header: "Cost", cell: ({ getValue }) => <span className="tabular">{formatCost(getValue<number>())}</span> },
  { accessorKey: "avg_latency_ms", header: "Latency", cell: ({ getValue }) => <span className="tabular">{fmtMs(getValue<number>())}</span> },
];

export default function ProjectAgentsPage() {
  const { scope } = useScope();
  const { id } = useProject();
  const overview = useWidgetData("mcp-overview", scope, id, fetchMcpOverview);
  const servers = useWidgetData("mcp-servers", scope, id, fetchMcpServers);
  const tools = useWidgetData("mcp-tools", scope, id, fetchMcpTools);

  const o = overview.data;
  const serverRows = (servers.data ?? []).slice(0, 8);
  const maxServerCost = Math.max(...serverRows.map((s) => s.cost_usd), 1);
  const noMcp = !overview.isLoading && (!o || o.total_tool_calls === 0);

  if (noMcp) {
    return <div className="p-5"><EmptyState icon={Network} title="No MCP tool activity" description="Wrap this project's tool calls with the Prism MCP SDK to capture per-tool cost and latency." /></div>;
  }

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Tool calls"  color="sky"   value={overview.isLoading ? <Skeleton className="h-7 w-16" /> : fmtNum(o?.total_tool_calls ?? 0)} />
        <KpiCard label="Tool cost"   color="gold"  value={overview.isLoading ? <Skeleton className="h-7 w-20" /> : formatCost(o?.total_tool_cost_usd ?? 0)} />
        <KpiCard label="Error rate"  color={(o?.tool_error_rate ?? 0) > 0.01 ? "coral" : "emerald"} value={overview.isLoading ? <Skeleton className="h-7 w-14" /> : `${((o?.tool_error_rate ?? 0) * 100).toFixed(1)}%`} />
        <KpiCard label="Avg latency" color="amber" value={overview.isLoading ? <Skeleton className="h-7 w-16" /> : fmtMs(o?.avg_tool_latency_ms ?? 0)} />
      </div>
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="Cost by MCP server">
            {servers.isLoading ? <Skeleton className="h-40 w-full" />
              : serverRows.length === 0 ? <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No server activity</div>
              : <div className="flex flex-col gap-3">
                  {serverRows.map((s) => (
                    <div key={s.mcp_server_name}>
                      <div className="flex justify-between text-xs"><span className="truncate font-medium">{s.mcp_server_name || "default"}</span><span className="tabular text-muted-foreground">{formatCost(s.cost_usd)}</span></div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(s.cost_usd / maxServerCost) * 100}%`, background: "hsl(var(--primary))" }} /></div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{fmtNum(s.total_calls)} calls · {fmtMs(s.avg_latency_ms)}</div>
                    </div>
                  ))}
                </div>}
          </ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="Cost by tool">
            {tools.isLoading ? <Skeleton className="h-64 w-full" /> : <DataTable columns={toolColumns} data={tools.data ?? []} empty="No tool calls in this range." />}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
