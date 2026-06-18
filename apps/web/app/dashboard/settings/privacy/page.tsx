"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Trash2, ShieldHalf } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { apiGet, apiPatch, ApiError } from "@/lib/api/client";
import { useRole } from "@/components/layout/role-context";
import { cn } from "@/lib/utils";

interface OrgSettings {
  pii_detection_enabled?: boolean;
  pii_detection_action?: "warn" | "block";
  pii_masking_enabled?: boolean;
  pii_mask_patterns?: string[];
}
interface GuardrailRule {
  id: string; name: string; apply_to: string; action: string; sampling_rate: number; is_active: boolean;
  guardrail_profiles: { name: string; type: string } | null;
}
interface IncidentSummary { total: number; by_type: Record<string, number>; by_model: Record<string, number> }

const actionClass = (a: string) => (a === "block" ? "signal" : a === "redact" ? "brand-text" : "text-muted-foreground");

export default function PrivacyPage() {
  const role = useRole();
  const canManage = role === "owner" || role === "administrator";
  const qc = useQueryClient();

  const org = useQuery({
    queryKey: ["org-settings"],
    queryFn: ({ signal }) => apiGet<OrgSettings>("/api/org", undefined, signal),
    enabled: canManage,
  });
  const guardrails = useQuery({
    queryKey: ["guardrails"],
    queryFn: ({ signal }) => apiGet<{ data: GuardrailRule[] }>("/api/guardrails", undefined, signal).then((r) => r.data ?? []),
    enabled: canManage,
  });
  const incidents = useQuery({
    queryKey: ["pii-incidents"],
    queryFn: ({ signal }) => apiGet<IncidentSummary>("/api/pii-incidents", undefined, signal).catch((e) => {
      if (e instanceof ApiError && (e.status === 402 || e.status === 403)) return null;
      throw e;
    }),
    enabled: canManage,
  });

  if (!canManage) {
    return <div className="p-5"><EmptyState icon={Lock} title="Privacy is manager-only" description="PII detection, masking, and guardrails are managed by organization owners and admins." /></div>;
  }

  async function patchOrg(patch: Partial<OrgSettings>) {
    try {
      await apiPatch("/api/org", patch);
      await qc.invalidateQueries({ queryKey: ["org-settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update setting");
    }
  }
  async function toggleRule(r: GuardrailRule) {
    try {
      await apiPatch("/api/guardrails", { id: r.id, is_active: !r.is_active });
      await qc.invalidateQueries({ queryKey: ["guardrails"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update rule"); }
  }
  async function deleteRule(id: string) {
    try {
      await fetch("/api/guardrails", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), credentials: "same-origin" });
      await qc.invalidateQueries({ queryKey: ["guardrails"] });
    } catch { toast.error("Couldn't delete rule"); }
  }

  const o = org.data;
  const rules = guardrails.data ?? [];
  const inc = incidents.data;

  return (
    <div className="grid grid-cols-12 gap-3 p-5">
      {/* PII config */}
      <div className="col-span-12 lg:col-span-5">
        <ChartCard title="PII detection &amp; masking" subtitle="scan prompts & completions for sensitive data">
          {org.isLoading ? <Skeleton className="h-40 w-full" />
            : <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                  <span className="text-sm">Detection enabled</span>
                  <Switch checked={!!o?.pii_detection_enabled} onCheckedChange={(v) => patchOrg({ pii_detection_enabled: v })} />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                  <span className={cn("text-sm", !o?.pii_detection_enabled && "text-muted-foreground")}>Action on detect</span>
                  <Select value={o?.pii_detection_action ?? "warn"} onValueChange={(v) => patchOrg({ pii_detection_action: v as "warn" | "block" })}>
                    <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="warn">Warn</SelectItem><SelectItem value="block">Block</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2.5">
                  <span className="text-sm">Masking enabled</span>
                  <Switch checked={!!o?.pii_masking_enabled} onCheckedChange={(v) => patchOrg({ pii_masking_enabled: v })} />
                </div>
                {(o?.pii_mask_patterns?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs text-muted-foreground">Masked patterns</p>
                    <div className="flex flex-wrap gap-1">
                      {o!.pii_mask_patterns!.map((p) => <span key={p} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{p}</span>)}
                    </div>
                  </div>
                )}
              </div>}
        </ChartCard>
      </div>

      {/* Guardrails */}
      <div className="col-span-12 lg:col-span-7">
        <ChartCard title="Guardrail rules" subtitle="warn / block / redact on input & output">
          {guardrails.isLoading ? <Skeleton className="h-40 w-full" />
            : rules.length === 0 ? <EmptyState icon={ShieldHalf} title="No guardrail rules" description="Create a guardrail profile (built-in PII, Bedrock, or Azure) and add warn/block/redact rules." />
            : <div className="flex flex-col gap-2">
                {rules.map((r) => (
                  <div key={r.id} className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-muted-foreground">{r.guardrail_profiles?.name ?? "—"}</span>
                    <span className="text-[11px] text-muted-foreground">{r.apply_to}</span>
                    <span className={cn("text-[11px] font-medium", actionClass(r.action))}>{r.action}</span>
                    {r.sampling_rate < 1 && <span className="text-[11px] text-muted-foreground">{Math.round(r.sampling_rate * 100)}%</span>}
                    <div className="ml-auto flex items-center gap-1">
                      <Switch checked={r.is_active} onCheckedChange={() => toggleRule(r)} />
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => deleteRule(r.id)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>}
        </ChartCard>
      </div>

      {/* Incidents */}
      <div className="col-span-12">
        <ChartCard title="PII incidents" subtitle="last 30 days">
          {incidents.isLoading ? <Skeleton className="h-24 w-full" />
            : !inc ? <div className="flex h-24 items-center justify-center px-6 text-center text-xs text-muted-foreground">PII incident tracking isn&apos;t available on your current plan.</div>
            : inc.total === 0 ? <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">No PII incidents detected.</div>
            : <div className="space-y-3">
                <div className="tabular text-2xl font-medium">{inc.total}</div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(inc.by_type).sort((a, b) => b[1] - a[1]).map(([type, n]) => (
                    <span key={type} className="rounded-md border border-border px-2 py-1 text-xs"><span className="signal font-medium">{type}</span> <span className="tabular text-muted-foreground">{n}</span></span>
                  ))}
                </div>
              </div>}
        </ChartCard>
      </div>
    </div>
  );
}
