"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, GitBranch, Cloud, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ChartCard } from "@/components/patterns/ChartCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { apiGet, apiPost, apiDelete } from "@/lib/api/client";
import { formatCost } from "@/lib/utils";

const PROVIDERS = ["openai", "anthropic", "google", "azure_openai", "bedrock", "groq", "xai", "fireworks", "together", "perplexity", "mistral", "cerebras", "nebius", "cohere", "ollama", "openai_compatible"] as const;
const REGIONS = ["global", "us", "eu", "in"] as const;
const isLocal = (p: string) => p === "ollama" || p === "openai_compatible";

function Empty({ msg }: { msg: string }) {
  return <div className="flex h-28 items-center justify-center px-4 text-center text-xs text-muted-foreground">{msg}</div>;
}

/* ── Provider keys ────────────────────────────────────────────────────────── */
interface ProviderKey {
  id: string; provider: string; name: string; key_hint: string | null;
  data_region: string; use_for_reconciliation: boolean; allowed_models: string[] | null;
  active_key_count: number; project_name: string | null;
}

export function ProviderKeysPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["provider-keys"],
    queryFn: ({ signal }) => apiGet<{ data: ProviderKey[] }>("/api/provider-keys", undefined, signal).then((r) => r.data ?? []),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [akid, setAkid] = useState(""); const [sak, setSak] = useState(""); const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [models, setModels] = useState("");
  const [region, setRegion] = useState<string>("global");
  const [recon, setRecon] = useState(false);

  function reset() { setProvider("openai"); setName(""); setKey(""); setEndpoint(""); setAkid(""); setSak(""); setAwsRegion("us-east-1"); setModels(""); setRegion("global"); setRecon(false); }

  async function add() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/provider-keys", {
        provider, name: name.trim(),
        key: isLocal(provider) || provider === "bedrock" ? "" : key.trim(),
        custom_endpoint: isLocal(provider) ? endpoint.trim() : undefined,
        access_key_id: provider === "bedrock" ? akid.trim() : undefined,
        secret_access_key: provider === "bedrock" ? sak.trim() : undefined,
        aws_region: provider === "bedrock" ? awsRegion.trim() : undefined,
        allowed_models: models.split(",").map((m) => m.trim()).filter(Boolean),
        data_region: region,
        use_for_reconciliation: recon,
      });
      toast.success("Provider key added");
      setOpen(false); reset();
      await qc.invalidateQueries({ queryKey: ["provider-keys"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add provider key");
    } finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await apiDelete(`/api/provider-keys/${id}`); toast.success("Provider key removed"); await qc.invalidateQueries({ queryKey: ["provider-keys"] }); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't remove"); }
  }

  const rows = data ?? [];
  return (
    <ChartCard title="Provider keys" subtitle="encrypted upstream credentials" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add</Button>}>
      {isLoading ? <Skeleton className="h-40 w-full" />
        : rows.length === 0 ? <Empty msg="No provider keys — add one so the gateway can reach your LLM provider." />
        : <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-xs text-muted-foreground">
                <th className="py-1.5 text-left font-normal">Provider</th><th className="text-left font-normal">Label</th><th className="text-left font-normal">Hint</th>
                <th className="text-left font-normal">Models</th><th className="text-left font-normal">Region</th><th className="text-center font-normal">Reconcile</th><th className="text-right font-normal">Keys</th><th className="text-right font-normal" />
              </tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 font-medium capitalize">{p.provider.replace("_", " ")}</td>
                    <td className="text-muted-foreground">{p.name}</td>
                    <td className="font-mono text-xs text-muted-foreground">…{p.key_hint || "—"}</td>
                    <td className="text-muted-foreground">{p.allowed_models?.length ? `${p.allowed_models.length} allowed` : "all"}</td>
                    <td className="uppercase text-muted-foreground">{p.data_region}</td>
                    <td className="text-center">{p.use_for_reconciliation ? <span className="positive text-xs">on</span> : <span className="text-xs text-muted-foreground">off</span>}</td>
                    <td className="tabular text-right text-muted-foreground">{p.active_key_count}</td>
                    <td className="text-right"><Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => remove(p.id)}><Trash2 className="h-4 w-4" /></Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add provider key</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PROVIDERS.map((p) => <SelectItem key={p} value={p}>{p.replace("_", " ")}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="pk-name">Label</Label><Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod" /></div>
            </div>
            {provider === "bedrock" ? (
              <>
                <div className="space-y-1.5"><Label>Access key ID</Label><Input value={akid} onChange={(e) => setAkid(e.target.value)} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5"><Label>Secret key</Label><Input type="password" value={sak} onChange={(e) => setSak(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>AWS region</Label><Input value={awsRegion} onChange={(e) => setAwsRegion(e.target.value)} /></div>
                </div>
              </>
            ) : isLocal(provider) ? (
              <div className="space-y-1.5"><Label>Custom endpoint</Label><Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="http://localhost:11434" /></div>
            ) : (
              <div className="space-y-1.5"><Label>API key</Label><Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" /></div>
            )}
            <div className="space-y-1.5"><Label>Allowed models <span className="text-muted-foreground">(comma-sep, blank = all)</span></Label><Input value={models} onChange={(e) => setModels(e.target.value)} placeholder="gpt-4o, gpt-4o-mini" /></div>
            <div className="flex items-center justify-between">
              <div className="space-y-1.5"><Label>Data region</Label>
                <Select value={region} onValueChange={setRegion}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                  <SelectContent>{REGIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent></Select>
              </div>
              <label className="flex items-center gap-2 pt-5 text-sm"><Switch checked={recon} onCheckedChange={setRecon} />Use for reconciliation</label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={add} disabled={busy || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Add key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChartCard>
  );
}

/* ── Routing ──────────────────────────────────────────────────────────────── */
interface RoutingRule {
  id: string; primary_model: string; fallback_models: string[] | null; trigger_on_codes: number[] | null;
  api_keys: { name: string | null } | null;
}

export function RoutingPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["routing"],
    queryFn: ({ signal }) => apiGet<{ data: RoutingRule[] }>("/api/routing", undefined, signal).then((r) => r.data ?? []),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [primary, setPrimary] = useState("");
  const [fallbacks, setFallbacks] = useState("");
  const [codes, setCodes] = useState("429, 503");

  async function add() {
    if (!primary.trim() || !fallbacks.trim() || busy) return;
    setBusy(true);
    try {
      await apiPost("/api/routing", {
        primary_model: primary.trim(),
        fallback_models: fallbacks.split(",").map((m) => m.trim()).filter(Boolean),
        trigger_on_codes: codes.split(",").map((c) => parseInt(c.trim(), 10)).filter((n) => !isNaN(n)),
      });
      toast.success("Routing rule saved");
      setOpen(false); setPrimary(""); setFallbacks(""); setCodes("429, 503");
      await qc.invalidateQueries({ queryKey: ["routing"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't save rule"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    try {
      await fetch("/api/routing", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }), credentials: "same-origin" });
      await qc.invalidateQueries({ queryKey: ["routing"] });
    } catch { toast.error("Couldn't delete rule"); }
  }

  const rows = data ?? [];
  return (
    <ChartCard title="Routing & fallback" subtitle="primary → fallback chains" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add</Button>}>
      {isLoading ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <Empty msg="No routing rules — add a fallback chain to survive provider outages." />
        : <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-md border border-border p-2.5 text-sm">
                <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs"><span className="text-foreground">{r.primary_model}</span><span className="text-muted-foreground"> → {(r.fallback_models ?? []).join(" → ")}</span></span>
                <span className="ml-auto text-[11px] text-muted-foreground">on {(r.trigger_on_codes ?? []).join(", ")}{r.api_keys?.name ? ` · ${r.api_keys.name}` : ""}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add routing rule</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5"><Label>Primary model</Label><Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="gpt-4o" /></div>
            <div className="space-y-1.5"><Label>Fallback models <span className="text-muted-foreground">(comma-sep, in order)</span></Label><Input value={fallbacks} onChange={(e) => setFallbacks(e.target.value)} placeholder="claude-sonnet-4-6, gpt-4o-mini" /></div>
            <div className="space-y-1.5"><Label>Trigger on status codes</Label><Input value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="429, 503" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={add} disabled={busy || !primary.trim() || !fallbacks.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Save rule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChartCard>
  );
}

/* ── Cloud billing connections ────────────────────────────────────────────── */
interface Connection {
  id: string; provider: string; display_name: string; attribution_mode: string;
  last_synced_at: string | null; last_sync_status: string | null; last_sync_cost_usd: number | null; is_active: boolean;
}
const CLOUD = ["aws", "pinecone", "qdrant", "weaviate", "azure"] as const;

export function ConnectionsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["billing-connections"],
    queryFn: ({ signal }) => apiGet<{ data: Connection[] }>("/api/billing/connections", undefined, signal).then((r) => r.data ?? []),
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [provider, setProvider] = useState<string>("aws");
  const [displayName, setDisplayName] = useState("");
  const [creds, setCreds] = useState("");

  async function add() {
    if (!displayName.trim() || busy) return;
    let credentials: Record<string, string>;
    try { credentials = creds.trim() ? JSON.parse(creds) : {}; } catch { toast.error("Credentials must be valid JSON"); return; }
    setBusy(true);
    try {
      await apiPost("/api/billing/connections", { provider, display_name: displayName.trim(), credentials, attribution_mode: "proportional" });
      toast.success("Connection added");
      setOpen(false); setDisplayName(""); setCreds(""); setProvider("aws");
      await qc.invalidateQueries({ queryKey: ["billing-connections"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't add connection"); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    try { await apiDelete(`/api/billing/connections/${id}`); await qc.invalidateQueries({ queryKey: ["billing-connections"] }); }
    catch { toast.error("Couldn't remove connection"); }
  }
  const dot = (s: string | null) => (s === "success" ? "hsl(var(--positive))" : s === "error" ? "hsl(var(--signal))" : "hsl(var(--muted-foreground))");

  const rows = data ?? [];
  return (
    <ChartCard title="Cloud billing connections" subtitle="reconcile actual infra cost" actions={<Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Connect</Button>}>
      {isLoading ? <Skeleton className="h-32 w-full" />
        : rows.length === 0 ? <Empty msg="No cloud billing connected — link AWS, Pinecone, or Qdrant to reconcile estimated vs actual cost." />
        : <div className="flex flex-col gap-2">
            {rows.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-md border border-border p-2.5">
                <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.display_name} <span className="text-xs font-normal capitalize text-muted-foreground">· {c.provider}</span></p>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full" style={{ background: dot(c.last_sync_status) }} />{c.last_synced_at ? `synced ${new Date(c.last_synced_at).toLocaleDateString()}` : "never synced"}{c.last_sync_cost_usd != null ? ` · ${formatCost(c.last_sync_cost_usd)}` : ""}</p>
                </div>
                <Button variant="ghost" size="icon" className="ml-auto h-7 w-7 text-muted-foreground hover:text-[hsl(var(--signal))]" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Connect cloud billing</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CLOUD.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent></Select>
              </div>
              <div className="space-y-1.5"><Label htmlFor="conn-name">Name</Label><Input id="conn-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="aws-prod" /></div>
            </div>
            <div className="space-y-1.5"><Label>Credentials <span className="text-muted-foreground">(JSON, encrypted server-side)</span></Label>
              <textarea value={creds} onChange={(e) => setCreds(e.target.value)} rows={4} placeholder='{"access_key_id":"…","secret_access_key":"…"}' className="w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs outline-none focus:border-primary" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={add} disabled={busy || !displayName.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Connect</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ChartCard>
  );
}
