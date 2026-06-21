"use client";

import { useRef, useState } from "react";
import { Bot, Send, Plus, Sparkles, User } from "lucide-react";
import { PageHeader } from "@/components/patterns/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiPost, ApiError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string; provenance?: unknown[]; data?: unknown }

const SUGGESTIONS = [
  "What drove cost up this week?",
  "Which model is most expensive per request?",
  "Show error rate by provider",
  "Where are we over budget?",
];

function provLabel(p: unknown): string {
  if (typeof p === "string") return p;
  if (p && typeof p === "object") {
    const o = p as Record<string, unknown>;
    return String(o.tool ?? o.name ?? o.pipe ?? o.metric ?? JSON.stringify(o)).slice(0, 48);
  }
  return String(p);
}

export default function CopilotPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [convId, setConvId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function send(q?: string) {
    const question = (q ?? input).trim();
    if (!question || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: question }]);
    setSending(true);
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      const res = await apiPost<{ conversation_id: string; answer: string; provenance?: unknown[]; data?: unknown }>(
        "/api/copilot/chat",
        { question, conversation_id: convId ?? undefined },
      );
      setConvId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: res.answer, provenance: res.provenance, data: res.data }]);
    } catch (e) {
      const msg = e instanceof ApiError && (e.status === 402 || e.status === 403)
        ? "Copilot requires the engine plan for your organization."
        : e instanceof ApiError ? e.message : "Something went wrong. Try again.";
      setMessages((m) => [...m, { role: "assistant", content: msg }]);
    } finally {
      setSending(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  }

  return (
    <div>
      <PageHeader
        title="Copilot"
        description="Ask questions about your cost, usage, and quality — answered from your live metrics."
        actions={messages.length > 0 ? <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setMessages([]); setConvId(null); }}><Plus className="h-4 w-4" />New chat</Button> : undefined}
      />

      <div className="mx-auto max-w-3xl px-5 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-primary"><Bot className="h-6 w-6" /></div>
            <div>
              <p className="text-sm font-medium">Ask Copilot anything about your data</p>
              <p className="mt-1 text-sm text-muted-foreground">It queries your metrics and answers with the sources it used.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />{s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m, i) => (
              <div key={i} className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><Bot className="h-4 w-4" /></div>}
                <div className={cn("min-w-0 max-w-[85%] rounded-lg px-3 py-2 text-sm", m.role === "user" ? "bg-secondary" : "dash-card w-full")}>
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                  {m.provenance && m.provenance.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 border-t border-border pt-2">
                      <span className="text-[11px] text-muted-foreground">Sources:</span>
                      {m.provenance.map((p, j) => <span key={j} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{provLabel(p)}</span>)}
                    </div>
                  )}
                  {m.data != null && Array.isArray(m.data) && m.data.length > 0 && (
                    <details className="mt-2 border-t border-border pt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">Data ({m.data.length} rows)</summary>
                      <pre className="dash-scroll mt-1 max-h-48 overflow-auto rounded bg-secondary p-2 text-[11px]">{JSON.stringify(m.data, null, 2)}</pre>
                    </details>
                  )}
                </div>
                {m.role === "user" && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted"><User className="h-4 w-4 text-muted-foreground" /></div>}
              </div>
            ))}
            {sending && (
              <div className="flex gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-primary"><Bot className="h-4 w-4" /></div>
                <div className="dash-card flex items-center gap-1 px-3 py-3"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" /><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" /></div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}

        <div className="sticky bottom-0 mt-4 bg-background pb-2 pt-2">
          <div className="relative">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about cost, usage, errors, budgets…"
              rows={2}
              className="pr-12"
            />
            <Button size="icon-sm" className="absolute bottom-2 right-2" onClick={() => send()} disabled={sending || !input.trim()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
