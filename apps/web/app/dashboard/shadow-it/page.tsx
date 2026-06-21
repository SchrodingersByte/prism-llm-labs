"use client";

import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { KpiCard } from "@/components/patterns/KpiCard";
import { BarList } from "@/components/charts/BarList";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface ShadowService {
  id: string; service_name: string; app_version: string | null;
  enforce_mode: string; language: string; first_seen_at: string; last_seen_at: string; bypass_count: number;
}
interface ServicesResp { services: ShadowService[]; coverage_score: number | null; total_services: number; total_bypasses: number }
interface BypassEvent {
  id: string; raw_module: string; environment: string; occurred_at: string;
  key_name: string | null; assigned_user_email: string | null; git_branch: string | null; app_name: string | null;
}
interface BypassResp { total: number; by_module: Record<string, number>; by_user: Record<string, number>; by_branch: Record<string, number>; recent: BypassEvent[] }

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtTime = (t: string) => t.slice(0, 16).replace("T", " ");
const toItems = (rec: Record<string, number>) => Object.entries(rec).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);

const MODE_CLASS: Record<string, string> = { strict: "positive", warn: "brand-text", transparent: "text-muted-foreground" };

export default function ShadowItPage() {
  const services = useQuery({ queryKey: ["shadow-services"], queryFn: ({ signal }) => apiGet<ServicesResp>("/api/shadow-it/services", undefined, signal), staleTime: 60_000 });
  const bypass = useQuery({ queryKey: ["enforce-status"], queryFn: ({ signal }) => apiGet<BypassResp>("/api/enforce/status", { days: "7" }, signal), staleTime: 60_000 });

  const svc = services.data;
  const rows = [...(svc?.services ?? [])].sort((a, b) => b.bypass_count - a.bypass_count);
  const cov = svc?.coverage_score;
  const covColor = cov == null ? "violet" : cov >= 90 ? "emerald" : cov >= 70 ? "amber" : "coral";

  return (
    <div>
      <PageHeader title="Shadow IT" description="Unmanaged services, SDK-bypass coverage, and gateway enforcement." />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Gateway coverage" color={covColor} value={services.isLoading ? <Skeleton className="h-7 w-14" /> : cov == null ? "—" : `${cov}%`} />
          <KpiCard label="Services detected" color="sky"   value={services.isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(svc?.total_services ?? 0)} />
          <KpiCard label="Total bypasses"    color="coral" value={services.isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(svc?.total_bypasses ?? 0)} />
          <KpiCard label="Bypass events (7d)" color="amber" value={bypass.isLoading ? <Skeleton className="h-7 w-12" /> : fmtNum(bypass.data?.total ?? 0)} />
        </div>

        <ChartCard title="Instrumented services" subtitle="services running the enforce package">
          {services.isLoading ? <Skeleton className="h-48 w-full" />
            : rows.length === 0 ? <EmptyState icon={Eye} title="No instrumented services" description="Install the enforce package in your services to detect SDK bypasses and shadow IT." />
            : <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-1.5 text-left font-normal">Service</th>
                      <th className="text-left font-normal">Language</th>
                      <th className="text-left font-normal">Mode</th>
                      <th className="text-left font-normal">Version</th>
                      <th className="text-left font-normal">Last seen</th>
                      <th className="pl-3 text-right font-normal">Bypasses</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.id} className="border-b border-border/60 last:border-0">
                        <td className="py-2 font-medium">{s.service_name}</td>
                        <td className="capitalize text-muted-foreground">{s.language}</td>
                        <td><span className={cn("capitalize", MODE_CLASS[s.enforce_mode] ?? "text-muted-foreground")}>{s.enforce_mode}</span></td>
                        <td className="text-muted-foreground">{s.app_version || "—"}</td>
                        <td className="text-muted-foreground">{fmtTime(s.last_seen_at)}</td>
                        <td className={cn("tabular pl-3 text-right", s.bypass_count > 0 ? "signal" : "text-muted-foreground")}>{fmtNum(s.bypass_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>}
        </ChartCard>

        <div className="grid grid-cols-12 gap-3">
          <div className="col-span-12 lg:col-span-6">
            <ChartCard title="Bypasses by module" subtitle="last 7 days">
              {bypass.isLoading ? <Skeleton className="h-40 w-full" /> : toItems(bypass.data?.by_module ?? {}).length === 0 ? <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">No bypass events in the last 7 days</div> : <BarList items={toItems(bypass.data!.by_module)} valueFormatter={fmtNum} />}
            </ChartCard>
          </div>
          <div className="col-span-12 lg:col-span-6">
            <ChartCard title="Bypasses by user" subtitle="last 7 days">
              {bypass.isLoading ? <Skeleton className="h-40 w-full" /> : toItems(bypass.data?.by_user ?? {}).length === 0 ? <div className="flex h-[160px] items-center justify-center text-xs text-muted-foreground">No bypass events in the last 7 days</div> : <BarList items={toItems(bypass.data!.by_user)} valueFormatter={fmtNum} />}
            </ChartCard>
          </div>
        </div>

        {!bypass.isLoading && (bypass.data?.recent.length ?? 0) > 0 && (
          <ChartCard title="Recent bypass events">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Module</th>
                    <th className="text-left font-normal">User / key</th>
                    <th className="text-left font-normal">Env</th>
                    <th className="text-left font-normal">Branch</th>
                    <th className="pl-3 text-left font-normal">When</th>
                  </tr>
                </thead>
                <tbody>
                  {bypass.data!.recent.map((e) => (
                    <tr key={e.id} className="border-b border-border/60 last:border-0">
                      <td className="py-2"><code className="rounded bg-muted px-1.5 py-0.5 text-xs">{e.raw_module}</code></td>
                      <td className="text-muted-foreground">{e.assigned_user_email || e.key_name || "—"}</td>
                      <td className="text-muted-foreground">{e.environment}</td>
                      <td className="text-muted-foreground">{e.git_branch || "—"}</td>
                      <td className="pl-3 text-muted-foreground">{fmtTime(e.occurred_at)}</td>
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
