"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, Plus, Copy, Loader2, Check } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useRole } from "@/components/layout/role-context";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { fetchProjects } from "@/lib/api/metrics";
import { cn } from "@/lib/utils";

interface ApiKey { id: string; name: string; key_prefix: string; environment: string; project_name: string | null; provider: string | null; is_active: boolean; last_used_at: string | null; created_at: string }

const fmtTime = (t: string | null) => (t ? t.slice(0, 10) : "never");
const envClass = (e: string) => (e === "production" ? "positive" : e === "staging" ? "brand-text" : "text-muted-foreground");

function copy(text: string) { navigator.clipboard?.writeText(text).then(() => toast("Copied")); }

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="dash-scroll overflow-x-auto rounded-md border border-border bg-secondary p-3 pr-9 text-xs leading-relaxed"><code>{code}</code></pre>
      <button onClick={() => copy(code)} aria-label="Copy" className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><Copy className="h-3.5 w-3.5" /></button>
    </div>
  );
}

export default function MyKeysPage() {
  const role = useRole();
  const canWrite = role !== "read_only";
  const qc = useQueryClient();
  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.useprism.dev";

  const { data, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: ({ signal }) => apiGet<{ data: ApiKey[] }>("/api/keys", undefined, signal).then((r) => r.data ?? []), staleTime: 60_000 });
  const keys = data ?? [];

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [env, setEnv] = useState("development");
  const [projectId, setProjectId] = useState("");
  const [saving, setSaving] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const projectsQ = useQuery({ queryKey: ["projects-list"], queryFn: ({ signal }) => fetchProjects(signal), staleTime: 60_000, enabled: open });
  const projects = projectsQ.data ?? [];

  async function create() {
    const pid = projectId || projects[0]?.id;
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!pid) { toast.error("No project available"); return; }
    setSaving(true);
    try {
      const res = await apiPost<{ data: { key: string } }>("/api/keys", { name: name.trim(), environment: env, project_id: pid });
      setRevealed(res.data.key);
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (e) {
      toast.error("Couldn't create key", { description: e instanceof ApiError ? e.message : "Try again." });
    } finally { setSaving(false); }
  }

  function closeDialog() { setOpen(false); setRevealed(null); setName(""); setEnv("development"); setProjectId(""); }

  const sdk = `npm i @prism-llm-labs/sdk

import { OpenAI } from "@prism-llm-labs/sdk";  // drop-in
const openai = new OpenAI();   // reads PRISM_API_KEY`;
  const env_ = `PRISM_API_KEY=${revealed ?? "<your key>"}
PRISM_GATEWAY_URL=${origin}   # optional — route via the gateway`;

  return (
    <div>
      <PageHeader title="My keys" description="API keys and the SDK setup snippet." actions={canWrite ? <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />New key</Button> : undefined} />

      <div className="grid grid-cols-12 gap-3 p-5">
        <div className="col-span-12 lg:col-span-7">
          <ChartCard title="API keys">
            {isLoading ? <Skeleton className="h-48 w-full" />
              : keys.length === 0 ? <EmptyState icon={KeyRound} title="No API keys" description="Create a key to authenticate the SDK or gateway." />
              : <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="py-1.5 text-left font-normal">Name</th>
                        <th className="text-left font-normal">Key</th>
                        <th className="text-left font-normal">Env</th>
                        <th className="text-left font-normal">Project</th>
                        <th className="pl-3 text-left font-normal">Last used</th>
                      </tr>
                    </thead>
                    <tbody>
                      {keys.map((k) => (
                        <tr key={k.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2 font-medium">{k.name}{k.provider && <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">gateway</span>}</td>
                          <td><code className="text-xs text-muted-foreground">{k.key_prefix}…</code></td>
                          <td><span className={cn("capitalize", envClass(k.environment))}>{k.environment}</span></td>
                          <td className="text-muted-foreground">{k.project_name || "—"}</td>
                          <td className="pl-3 text-muted-foreground">{fmtTime(k.last_used_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>}
          </ChartCard>
        </div>
        <div className="col-span-12 lg:col-span-5">
          <ChartCard title="SDK setup">
            <div className="space-y-3">
              <CodeBlock code={sdk} />
              <CodeBlock code={env_} />
            </div>
          </ChartCard>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader><DialogTitle>{revealed ? "Key created" : "New API key"}</DialogTitle></DialogHeader>
          {revealed ? (
            <div className="space-y-2">
              <CodeBlock code={revealed} />
              <p className="text-xs signal">Copy it now — it won&apos;t be shown again.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm"><span className="text-xs text-muted-foreground">Name</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="local-dev" className="mt-1" />
              </label>
              <div className="flex gap-3">
                <label className="block flex-1 text-sm"><span className="text-xs text-muted-foreground">Environment</span>
                  <select value={env} onChange={(e) => setEnv(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    <option value="development">development</option><option value="staging">staging</option><option value="production">production</option>
                  </select>
                </label>
                <label className="block flex-1 text-sm"><span className="text-xs text-muted-foreground">Project</span>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-sm">
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}
          <DialogFooter>
            {revealed ? <Button size="sm" className="gap-1.5" onClick={closeDialog}><Check className="h-4 w-4" />Done</Button>
              : <>
                  <Button variant="ghost" size="sm" onClick={closeDialog}>Cancel</Button>
                  <Button size="sm" className="gap-1.5" onClick={create} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}Create</Button>
                </>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
