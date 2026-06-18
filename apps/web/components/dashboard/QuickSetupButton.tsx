"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Rocket, KeyRound, Send, Plug, Check, Copy, ArrowLeft, ArrowRight, ExternalLink, Loader2,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiPost, ApiError } from "@/lib/api/client";
import { fetchProjects } from "@/lib/api/metrics";
import { cn } from "@/lib/utils";

const STEPS = [
  { icon: KeyRound, label: "Prism key" },
  { icon: Send,     label: "First event" },
  { icon: Plug,     label: "Gateway" },
];

function copy(text: string) {
  navigator.clipboard?.writeText(text).then(
    () => toast("Copied to clipboard"),
    () => toast.error("Couldn't copy"),
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="relative">
      <pre className="dash-scroll overflow-x-auto rounded-md border border-border bg-secondary p-3 pr-9 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
      <button onClick={() => copy(code)} aria-label="Copy code"
        className="absolute right-2 top-2 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Topbar "Quick setup" portal — an observability-first onboarding flow:
 *   1. create a Prism key  →  2. integrate the SDK + fire a test event  →  3. gateway mode.
 */
export function QuickSetupButton() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");

  const projectsQ = useQuery({
    queryKey: ["projects-list"],
    queryFn: ({ signal }) => fetchProjects(signal),
    staleTime: 60_000,
    enabled: open,
  });
  const projects = useMemo(() => projectsQ.data ?? [], [projectsQ.data]);

  useEffect(() => {
    if (!projectId && projects.length > 0) setProjectId(projects[0]!.id);
  }, [projects, projectId]);

  const origin = typeof window !== "undefined" ? window.location.origin : "https://app.useprism.dev";
  const keyForSnippet = createdKey ?? "$PRISM_API_KEY";

  async function createKey() {
    if (!projectId) { toast.error("No project found", { description: "Create a project first." }); return; }
    setCreating(true);
    try {
      const res = await apiPost<{ data: { key: string } }>("/api/keys", {
        name: "Quick start key", environment: "development", project_id: projectId,
      });
      setCreatedKey(res.data.key);
      toast.success("Prism key created", { description: "Copy it now — it won't be shown again." });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Please try again.";
      toast.error("Couldn't create key", { description: msg });
    } finally {
      setCreating(false);
    }
  }

  const sdkSnippet = `npm i @prism-llm-labs/sdk

// Swap your OpenAI import — that's the only change.
import { OpenAI } from "@prism-llm-labs/sdk";

const openai = new OpenAI();            // reads PRISM_API_KEY from env
const res = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Hello from Prism!" }],
});`;

  const envSnippet = `PRISM_API_KEY=${createdKey ?? "<your key>"}
# Optional — route calls through the gateway for budgets & governance:
PRISM_GATEWAY_URL=${origin}`;

  const curlSnippet = `curl ${origin}/api/gateway/openai/v1/chat/completions \\
  -H "x-prism-key: ${keyForSnippet}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}'`;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setStep(0); }}>
      <Button size="sm" className="gap-1.5" onClick={() => { setOpen(true); setStep(0); }}>
        <Rocket className="h-4 w-4" />Quick setup
      </Button>

      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto dash-scroll">
        <DialogHeader>
          <DialogTitle>Quick setup</DialogTitle>
          <DialogDescription>Get telemetry flowing in three steps — observability first.</DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex flex-1 items-center gap-2">
              <button onClick={() => setStep(i)}
                className={cn("flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                  i === step ? "bg-primary text-primary-foreground" : i < step ? "text-primary" : "text-muted-foreground hover:bg-accent")}>
                {i < step ? <Check className="h-3.5 w-3.5" /> : <s.icon className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <div className="min-h-[260px] space-y-3 text-sm">
          {step === 0 && (
            <>
              <p className="text-muted-foreground">
                Prism starts with observability — one key captures cost, tokens, latency, and errors from every LLM call.
              </p>
              {projects.length > 1 && (
                <label className="block text-xs">
                  <span className="text-muted-foreground">Project</span>
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
                    className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-sm">
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {createdKey ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs positive"><Check className="h-3.5 w-3.5" />Key created</div>
                  <CodeBlock code={createdKey} />
                  <p className="text-xs signal">Copy it now — it won&apos;t be shown again.</p>
                </div>
              ) : (
                <Button onClick={createKey} disabled={creating || !projectId} className="gap-1.5">
                  {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  Create Prism key
                </Button>
              )}
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-muted-foreground">Drop in the Prism client — every call is tracked, no other code changes.</p>
              <CodeBlock code={sdkSnippet} />
              <p className="text-xs font-medium">Set your environment</p>
              <CodeBlock code={envSnippet} />
              <p className="text-xs font-medium">Or fire a test event over HTTP</p>
              <CodeBlock code={curlSnippet} />
              <p className="text-xs text-muted-foreground">The gateway call routes to your provider once you link a provider key — that&apos;s the next step.</p>
            </>
          )}

          {step === 2 && (
            <>
              <p className="text-muted-foreground">
                Gateway mode routes every call through Prism with zero SDK code — enforcing budgets, model governance,
                guardrails, and caching. Add a provider key and link it to your Prism key to go live.
              </p>
              <ol className="space-y-2">
                {[
                  { n: 1, t: "Add a provider key", d: "OpenAI, Anthropic, Google, and 12 more." },
                  { n: 2, t: "Link it to your Prism key", d: "This flips the key into gateway mode." },
                  { n: 3, t: "Point PRISM_GATEWAY_URL at Prism", d: "…or use the cURL from the previous step." },
                ].map((s) => (
                  <li key={s.n} className="flex gap-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] font-medium text-primary">{s.n}</span>
                    <span><span className="font-medium">{s.t}</span> <span className="text-muted-foreground">— {s.d}</span></span>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href="/dashboard/settings/integrations" onClick={() => setOpen(false)}>
                  <Button variant="outline" size="sm" className="gap-1.5"><Plug className="h-4 w-4" />Add a provider key</Button>
                </Link>
                <Link href="/dashboard/settings/access" onClick={() => setOpen(false)}>
                  <Button variant="ghost" size="sm" className="gap-1.5"><KeyRound className="h-4 w-4" />Manage keys<ExternalLink className="h-3.5 w-3.5" /></Button>
                </Link>
              </div>
            </>
          )}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button size="sm" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))} className="gap-1.5">
              Next<ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="sm" onClick={() => setOpen(false)} className="gap-1.5"><Check className="h-4 w-4" />Done</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
