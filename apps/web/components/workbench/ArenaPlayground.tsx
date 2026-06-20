"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Plus, X, Loader2, FlaskConical } from "lucide-react";
import { ChartCard } from "@/components/patterns/ChartCard";
import { EmptyState } from "@/components/patterns/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { apiGet, apiPost, ApiError } from "@/lib/api/client";
import { calculateCost } from "@/lib/pricing/table";
import { formatCost } from "@/lib/utils";

interface ProviderKey { id: string; provider: string; name: string; allowed_models: string[]; key_hint: string }
interface Slot { providerKeyId: string; model: string }
interface RunResult { loading: boolean; content?: string; error?: string; inTok?: number; outTok?: number; latency?: number; cost?: number }

const MAX_SLOTS = 3;
const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const fmtNum = (n: number) => compact.format(n);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`);

interface OpenAIResp { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }
interface AnthropicResp { content?: { text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } }
interface GoogleResp { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }

function normalize(provider: string, data: unknown): { content: string; inTok: number; outTok: number } {
  if (provider === "anthropic") {
    const d = data as AnthropicResp;
    return { content: (d.content ?? []).map((c) => c.text ?? "").join(""), inTok: d.usage?.input_tokens ?? 0, outTok: d.usage?.output_tokens ?? 0 };
  }
  if (provider === "google") {
    const d = data as GoogleResp;
    return { content: (d.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""), inTok: d.usageMetadata?.promptTokenCount ?? 0, outTok: d.usageMetadata?.candidatesTokenCount ?? 0 };
  }
  const d = data as OpenAIResp;
  return { content: d.choices?.[0]?.message?.content ?? "", inTok: d.usage?.prompt_tokens ?? 0, outTok: d.usage?.completion_tokens ?? 0 };
}

export function ArenaPlayground() {
  const { data: keysData, isLoading } = useQuery({
    queryKey: ["provider-keys"],
    queryFn: ({ signal }) => apiGet<{ data: ProviderKey[] }>("/api/provider-keys", undefined, signal).then((r) => r.data ?? []),
    staleTime: 60_000,
  });
  const keys = useMemo(() => keysData ?? [], [keysData]);
  const keyById = useMemo(() => new Map(keys.map((k) => [k.id, k])), [keys]);

  const [system, setSystem] = useState("");
  const [userMsg, setUserMsg] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [results, setResults] = useState<Record<number, RunResult>>({});
  const [running, setRunning] = useState(false);

  // Seed two slots once keys load (a compare needs at least two).
  useEffect(() => {
    if (slots.length === 0 && keys.length > 0) {
      const first = { providerKeyId: keys[0]!.id, model: keys[0]!.allowed_models[0] ?? "" };
      setSlots([first, { ...first }]);
    }
  }, [keys, slots.length]);

  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((s) => s.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  }

  async function run() {
    if (!userMsg.trim()) { toast.error("Enter a user message"); return; }
    const active = slots.map((s, i) => ({ ...s, i })).filter((s) => s.providerKeyId && s.model.trim());
    if (active.length === 0) { toast.error("Pick a provider key and model"); return; }

    setRunning(true);
    setResults(Object.fromEntries(active.map((s) => [s.i, { loading: true } as RunResult])));
    const messages = [...(system.trim() ? [{ role: "system", content: system }] : []), { role: "user", content: userMsg }];

    await Promise.all(active.map(async (s) => {
      const t0 = Date.now();
      try {
        const data = await apiPost<unknown>("/api/arena/chat", { provider_key_id: s.providerKeyId, model: s.model, messages, stream: false });
        const latency = Date.now() - t0;
        const provider = keyById.get(s.providerKeyId)?.provider ?? "openai";
        const { content, inTok, outTok } = normalize(provider, data);
        setResults((r) => ({ ...r, [s.i]: { loading: false, content, inTok, outTok, latency, cost: calculateCost(s.model, inTok, outTok, 0) } }));
      } catch (e) {
        setResults((r) => ({ ...r, [s.i]: { loading: false, error: e instanceof ApiError ? e.message : "Run failed" } }));
      }
    }));
    setRunning(false);
  }

  if (isLoading) return <div className="p-5"><Skeleton className="h-64 w-full" /></div>;
  if (keys.length === 0) {
    return (
      <div className="p-5">
        <EmptyState icon={FlaskConical} title="No provider keys" description="The playground runs against your own provider keys. Add one under Settings → Integrations to start comparing models."
          action={<Link href="/dashboard/settings/integrations"><Button size="sm">Add a provider key</Button></Link>} />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-5">
      <ChartCard title="Compose" subtitle="prompt once, run against up to 3 models">
        <div className="space-y-3">
          <label className="block">
            <span className="text-xs text-muted-foreground">System (optional)</span>
            <Textarea value={system} onChange={(e) => setSystem(e.target.value)} rows={2} placeholder="You are a helpful assistant…" className="mt-1" />
          </label>
          <label className="block">
            <span className="text-xs text-muted-foreground">User message</span>
            <Textarea value={userMsg} onChange={(e) => setUserMsg(e.target.value)} rows={4} placeholder="Ask something…" className="mt-1" />
          </label>

          <div className="space-y-2">
            <span className="text-xs text-muted-foreground">Models</span>
            {slots.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <select value={s.providerKeyId} onChange={(e) => setSlot(i, { providerKeyId: e.target.value, model: keyById.get(e.target.value)?.allowed_models[0] ?? s.model })}
                  className="h-9 w-48 rounded-md border border-border bg-background px-2 text-sm">
                  {keys.map((k) => <option key={k.id} value={k.id}>{k.name} · {k.provider}</option>)}
                </select>
                <Input list={`models-${i}`} value={s.model} onChange={(e) => setSlot(i, { model: e.target.value })} placeholder="model id (e.g. gpt-4o-mini)" className="h-9 flex-1" />
                <datalist id={`models-${i}`}>
                  {(keyById.get(s.providerKeyId)?.allowed_models ?? []).map((m) => <option key={m} value={m} />)}
                </datalist>
                {slots.length > 1 && (
                  <button onClick={() => setSlots((sl) => sl.filter((_, idx) => idx !== i))} aria-label="Remove model" className="text-muted-foreground hover:text-[hsl(var(--signal))]"><X className="h-4 w-4" /></button>
                )}
              </div>
            ))}
            {slots.length < MAX_SLOTS && (
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setSlots((sl) => [...sl, { providerKeyId: keys[0]!.id, model: "" }])}>
                <Plus className="h-4 w-4" />Add model
              </Button>
            )}
          </div>

          <Button size="sm" className="gap-1.5" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run comparison
          </Button>
        </div>
      </ChartCard>

      {Object.keys(results).length > 0 && (
        <div className="flex flex-col gap-3 lg:flex-row">
          {slots.map((s, i) => {
            const res = results[i];
            if (!res) return null;
            const k = keyById.get(s.providerKeyId);
            return (
              <div key={i} className="dash-card flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                  <span className="truncate text-sm font-medium">{s.model || "—"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{k?.provider}</span>
                </div>
                <div className="dash-scroll max-h-[420px] min-h-[120px] flex-1 overflow-y-auto p-4">
                  {res.loading ? <Skeleton className="h-24 w-full" />
                    : res.error ? <p className="text-sm signal">{res.error}</p>
                    : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{res.content || <span className="text-muted-foreground">(empty response)</span>}</p>}
                </div>
                {!res.loading && !res.error && (
                  <div className="flex items-center justify-between border-t border-border px-4 py-2 text-xs text-muted-foreground">
                    <span className="tabular">{fmtNum(res.inTok ?? 0)} in · {fmtNum(res.outTok ?? 0)} out</span>
                    <span className="tabular">{fmtMs(res.latency ?? 0)} · <span className="text-foreground">{formatCost(res.cost ?? 0)}</span></span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
