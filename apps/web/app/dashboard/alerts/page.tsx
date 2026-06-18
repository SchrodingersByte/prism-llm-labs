"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/patterns/PageHeader";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { apiGet, apiPost, apiPut, apiDelete } from "@/lib/api/client";
import { useCanManage } from "@/components/layout/role-context";
import { cn } from "@/lib/utils";

const TRIGGERS = [
  { value: "budget_threshold",         label: "Budget threshold",  unit: "%",     hint: "Fire when monthly budget usage crosses this percentage." },
  { value: "spend_spike",              label: "Spend spike",       unit: "×",     hint: "Daily spend exceeds this multiple of the 7-day average." },
  { value: "statistical_anomaly",      label: "Statistical anomaly", unit: "σ",   hint: "Daily spend this many standard deviations above baseline." },
  { value: "error_rate",               label: "Error rate",        unit: "%",     hint: "Error rate over the window exceeds this percentage." },
  { value: "single_call_cost",         label: "Single-call cost",  unit: "$",     hint: "A single LLM call costs more than this." },
  { value: "daily_limit",              label: "Daily spend limit", unit: "$",     hint: "Total spend in a day exceeds this amount." },
  { value: "pii_detection",            label: "PII detection",     unit: "events", hint: "PII detections in the window exceed this count." },
  { value: "tool_call_loop",           label: "Tool-call loop",    unit: "calls", hint: "Repeated tool calls within a session exceed this count." },
  { value: "session_budget_threshold", label: "Session budget",    unit: "$",     hint: "A single session costs more than this." },
  { value: "velocity_spike",           label: "Velocity spike",    unit: "×",     hint: "Request rate exceeds this multiple of the baseline." },
] as const;

type TriggerValue = (typeof TRIGGERS)[number]["value"];
const CHANNELS = ["email", "slack", "webhook"] as const;
type Channel = (typeof CHANNELS)[number];

interface AlertRow {
  id: string;
  name: string;
  trigger_type: string;
  threshold_value: number | null;
  channels: string[] | null;
  is_active: boolean;
  last_fired_at: string | null;
  project_id: string | null;
}
interface ProjectLite { id: string; name: string }

function triggerLabel(t: string): string {
  return TRIGGERS.find((x) => x.value === t)?.label ?? t;
}
function fmtThreshold(t: string, v: number | null): string {
  if (v == null) return "—";
  const u = TRIGGERS.find((x) => x.value === t)?.unit ?? "";
  if (u === "$") return `$${v}`;
  if (u === "%") return `${v}%`;
  if (u === "×" || u === "σ") return `${v}${u}`;
  return `${v} ${u}`;
}

export default function AlertsPage() {
  const canManage = useCanManage();
  const qc = useQueryClient();

  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: ({ signal }) => apiGet<{ data: AlertRow[] }>("/api/alerts", undefined, signal).then((r) => r.data ?? []),
  });
  const { data: projects = [] } = useQuery({
    queryKey: ["projects-scope"],
    queryFn: ({ signal }) => apiGet<{ data: ProjectLite[] }>("/api/projects", undefined, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
    enabled: canManage,
  });

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // create-form state
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<TriggerValue>("budget_threshold");
  const [threshold, setThreshold] = useState("");
  const [channels, setChannels] = useState<Set<Channel>>(new Set<Channel>(["email"]));
  const [slackUrl, setSlackUrl] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [projectId, setProjectId] = useState("org");

  const meta = TRIGGERS.find((x) => x.value === trigger)!;

  function toggleChannel(c: Channel) {
    setChannels((prev) => {
      const next = new Set<Channel>(prev);
      if (next.has(c)) { if (next.size > 1) next.delete(c); } else next.add(c);
      return next;
    });
  }
  function resetForm() {
    setName(""); setTrigger("budget_threshold"); setThreshold("");
    setChannels(new Set<Channel>(["email"])); setSlackUrl(""); setWebhookUrl(""); setProjectId("org");
  }

  async function create() {
    const n = name.trim();
    const value = Number(threshold);
    if (!n || !(value > 0) || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/alerts", {
        name: n,
        trigger_type: trigger,
        threshold_value: value,
        channels: Array.from(channels),
        project_id: projectId === "org" ? undefined : projectId,
        slack_webhook: channels.has("slack") && slackUrl.trim() ? slackUrl.trim() : undefined,
        custom_webhook: channels.has("webhook") && webhookUrl.trim() ? webhookUrl.trim() : undefined,
      });
      toast.success("Alert created");
      setOpen(false); resetForm();
      await qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create alert");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(a: AlertRow) {
    try {
      await apiPut(`/api/alerts/${a.id}`, { is_active: !a.is_active });
      await qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't update alert");
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/api/alerts/${id}`);
      setConfirmId(null);
      toast.success("Alert deleted");
      await qc.invalidateQueries({ queryKey: ["alerts"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete alert");
    }
  }

  const rows = alerts ?? [];

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Notify your team on budget, spend, error, and agent-behavior triggers."
        actions={canManage ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New alert</Button> : undefined}
      />

      <div className="p-5">
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No alerts configured"
            description={canManage ? "Create an alert to get notified on budget breaches, spend spikes, error rates, and agent loops." : "No alert rules yet. Ask an owner or admin to set them up."}
            action={canManage ? <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New alert</Button> : undefined}
          />
        ) : (
          <div className="dash-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 text-left font-normal">Name</th>
                  <th className="text-left font-normal">Trigger</th>
                  <th className="text-right font-normal">Threshold</th>
                  <th className="px-4 text-left font-normal">Channels</th>
                  <th className="text-left font-normal">Scope</th>
                  <th className="text-left font-normal">Last fired</th>
                  <th className="text-center font-normal">Active</th>
                  {canManage && <th className="px-4 text-right font-normal" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-medium">{a.name}</td>
                    <td>{triggerLabel(a.trigger_type)}</td>
                    <td className="tabular text-right">{fmtThreshold(a.trigger_type, a.threshold_value)}</td>
                    <td className="px-4">
                      <div className="flex gap-1">
                        {(a.channels ?? []).map((c) => (
                          <span key={c} className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">{c}</span>
                        ))}
                      </div>
                    </td>
                    <td className="text-muted-foreground">
                      {a.project_id ? (projects.find((p) => p.id === a.project_id)?.name ?? "Project") : "Org-wide"}
                    </td>
                    <td className="text-muted-foreground">{a.last_fired_at ? new Date(a.last_fired_at).toLocaleDateString() : "Never"}</td>
                    <td className="text-center">
                      <div className="flex justify-center">
                        <Switch checked={a.is_active} disabled={!canManage} onCheckedChange={() => toggle(a)} />
                      </div>
                    </td>
                    {canManage && (
                      <td className="px-4 text-right">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => setConfirmId(a.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New alert</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="alert-name">Name</Label>
              <Input id="alert-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Monthly budget warning" autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Trigger</Label>
                <Select value={trigger} onValueChange={(v) => setTrigger(v as TriggerValue)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRIGGERS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert-threshold">Threshold ({meta.unit})</Label>
                <Input id="alert-threshold" type="number" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="0" />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{meta.hint}</p>

            <div className="space-y-1.5">
              <Label>Channels</Label>
              <div className="flex gap-1.5">
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleChannel(c)}
                    className={cn(
                      "rounded-md border px-3 py-1.5 text-xs capitalize transition-colors",
                      channels.has(c) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {channels.has("slack") && (
              <div className="space-y-1.5">
                <Label htmlFor="slack-url">Slack webhook URL</Label>
                <Input id="slack-url" value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/…" />
              </div>
            )}
            {channels.has("webhook") && (
              <div className="space-y-1.5">
                <Label htmlFor="webhook-url">Webhook URL</Label>
                <Input id="webhook-url" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://…" />
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="org">Org-wide</SelectItem>
                  {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={create} disabled={busy || !name.trim() || !(Number(threshold) > 0)}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Create alert
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmId !== null} onOpenChange={(o) => !o && setConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete alert?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">This removes the rule and stops its notifications. This can&apos;t be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmId && remove(confirmId)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
