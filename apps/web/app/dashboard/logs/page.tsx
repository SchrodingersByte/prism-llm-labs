"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api/client";
import { cn, formatCost } from "@/lib/utils";

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtMs = (ms: number | null) => (ms == null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
const fmtTime = (t: string) => t.slice(5, 16).replace("T", " ");

interface LogRow {
  id: string;
  model: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  latency_ms: number | null;
  status_code: number | null;
  session_id: string | null;
  created_at: string;
  trace_id: string | null;
  api_keys: { name: string | null; key_prefix: string | null } | null;
}

const LIMIT = 50;
const STATUSES = [["all", "All"], ["ok", "OK"], ["error", "Errors"]] as const;

export default function LogsPage() {
  const [status, setStatus] = useState<"all" | "ok" | "error">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");   // committed search (on Enter)
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["logs", status, query, offset],
    queryFn: ({ signal }) => apiGet<{ data: LogRow[]; total: number }>(
      "/api/logs",
      { status, search: query || undefined, limit: String(LIMIT), offset: String(offset) },
      signal,
    ),
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + LIMIT, total);

  function setStatusReset(s: "all" | "ok" | "error") { setStatus(s); setOffset(0); }
  function commitSearch() { setQuery(search.trim()); setOffset(0); }

  return (
    <div>
      <PageHeader title="Logs" description="Request log explorer — captured for keys with prompt logging enabled." />

      <div className="p-5">
        <ChartCard
          title="Requests"
          subtitle={total > 0 ? `${pageStart}–${pageEnd} of ${fmtNum(total)}` : undefined}
          actions={
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
                {STATUSES.map(([v, label]) => (
                  <button key={v} onClick={() => setStatusReset(v)}
                    className={cn("rounded px-2 py-1 text-xs transition-colors", status === v ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commitSearch()} placeholder="Search completions…" className="h-8 w-44 pl-7 text-xs" />
              </div>
            </div>
          }
        >
          {isLoading && rows.length === 0 ? <Skeleton className="h-64 w-full" />
            : rows.length === 0 ? <EmptyState icon={ScrollText} title="No request logs" description={query || status !== "all" ? "No logs match this filter." : "Enable prompt logging on an API key to capture request and response bodies here."} />
            : <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Time</th>
                        <th className="text-left font-normal">Model</th>
                        <th className="text-right font-normal">Tokens</th>
                        <th className="text-right font-normal">Cost</th>
                        <th className="text-right font-normal">Latency</th>
                        <th className="px-3 text-center font-normal">Status</th>
                        <th className="text-left font-normal">Key</th>
                        <th className="text-right font-normal" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const err = (r.status_code ?? 200) >= 400;
                        return (
                          <tr key={r.id} className="border-b border-border/60 last:border-0">
                            <td className="py-2 text-muted-foreground">{fmtTime(r.created_at)}</td>
                            <td><span className="font-medium">{r.model}</span><span className="ml-1.5 text-xs text-muted-foreground">{r.provider}</span></td>
                            <td className="tabular text-right text-muted-foreground">{fmtNum(r.input_tokens)}→{fmtNum(r.output_tokens)}</td>
                            <td className="tabular text-right">{formatCost(r.cost_usd)}</td>
                            <td className="tabular text-right text-muted-foreground">{fmtMs(r.latency_ms)}</td>
                            <td className="px-3 text-center"><span className={cn("tabular text-xs", err ? "signal" : "positive")}>{err ? r.status_code : "ok"}</span></td>
                            <td className="text-muted-foreground">{r.api_keys?.name ?? r.api_keys?.key_prefix ?? "—"}</td>
                            <td className="text-right">{r.session_id ? <Link href={`/dashboard/sessions/${r.session_id}`} className="text-xs text-primary hover:underline">session</Link> : null}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}><ChevronLeft className="h-4 w-4" />Prev</Button>
                  <Button variant="outline" size="sm" disabled={pageEnd >= total} onClick={() => setOffset(offset + LIMIT)}>Next<ChevronRight className="h-4 w-4" /></Button>
                </div>
              </>}
        </ChartCard>
      </div>
    </div>
  );
}
