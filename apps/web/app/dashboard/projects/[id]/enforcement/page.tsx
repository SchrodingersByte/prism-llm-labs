"use client";

import { ShieldCheck } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api/client";

interface ServicesResp { coverage_score: number | null; total_services: number; total_bypasses: number }
interface BypassEvent { id: string; raw_module: string; environment: string; occurred_at: string; key_name: string | null; assigned_user_email: string | null; git_branch: string | null }
interface BypassResp { total: number; recent: BypassEvent[] }

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtTime = (t: string) => t.slice(0, 16).replace("T", " ");

export default function ProjectEnforcementPage() {
  const services = useQuery({ queryKey: ["shadow-services"], queryFn: ({ signal }) => apiGet<ServicesResp>("/api/shadow-it/services", undefined, signal), staleTime: 60_000 });
  const bypass = useQuery({ queryKey: ["enforce-status"], queryFn: ({ signal }) => apiGet<BypassResp>("/api/enforce/status", { days: "7" }, signal), staleTime: 60_000 });
  const cov = services.data?.coverage_score;
  const covColor = cov == null ? "violet" : cov >= 90 ? "emerald" : cov >= 70 ? "amber" : "coral";
  const recent = bypass.data?.recent ?? [];

  return (
    <div>
      <PageHeader title="Enforcement" description="Gateway coverage and SDK-bypass detection (tracked org-wide)." />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard label="Gateway coverage" color={covColor} value={services.isLoading ? <Skeleton className="h-7 w-14" /> : cov == null ? "—" : `${cov}%`} />
          <KpiCard label="Services" color="sky" value={services.isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(services.data?.total_services ?? 0)} />
          <KpiCard label="Bypasses (7d)" color="coral" value={bypass.isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(bypass.data?.total ?? 0)} />
        </div>
        <ChartCard title="Recent bypass events" subtitle="calls that skipped the gateway">
          {bypass.isLoading ? <Skeleton className="h-40 w-full" />
            : recent.length === 0 ? <EmptyState icon={ShieldCheck} title="No bypasses detected" description="All instrumented traffic is going through Prism. Install the enforce package to detect SDK bypasses." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Module</th>
                    <th className="text-left font-normal">User / key</th>
                    <th className="text-left font-normal">Env</th>
                    <th className="pl-3 text-left font-normal">When</th>
                  </tr></thead>
                  <tbody>
                    {recent.map((e) => (
                      <tr key={e.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.raw_module}</code></td>
                        <td className="text-muted-foreground">{e.assigned_user_email || e.key_name || "—"}</td>
                        <td className="text-muted-foreground">{e.environment}</td>
                        <td className="pl-3 text-muted-foreground">{fmtTime(e.occurred_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </ChartCard>
      </div>
    </div>
  );
}
