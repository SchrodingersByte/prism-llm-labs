/**
 * Illustrative "what it looks like" mockups for the Features page — one per
 * capability area. Purely presentational (sample data), server-renderable.
 */
import { ArrowRight, Bot, Sparkles } from "lucide-react";

export type VizKind = "capture" | "observe" | "finops" | "govern" | "quality" | "operate";

function MiniArea({ stroke, fill }: { stroke: string; fill: string }) {
  return (
    <svg viewBox="0 0 320 80" className="h-16 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.4" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M0,64 C50,58 70,40 110,44 C160,49 180,24 230,30 C270,34 300,16 320,12 L320,80 L0,80 Z" fill={`url(#${fill})`} />
      <path d="M0,64 C50,58 70,40 110,44 C160,49 180,24 230,30 C270,34 300,16 320,12" fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

function Bar({ label, pct, color, value }: { label: string; pct: number; color: string; value?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-[var(--mk-fg)]">{label}</span>
        <span className="tabular-nums text-[var(--mk-faint)]">{value ?? `${pct}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

function CaptureViz() {
  const provs = ["OpenAI", "Anthropic", "Google", "Bedrock", "Mistral", "Groq"];
  return (
    <div className="mk-card overflow-hidden">
      <div className="border-b px-4 py-2 text-xs text-[var(--mk-faint)] mk-hairline">app.ts</div>
      <pre className="px-4 py-3 text-[12px] leading-relaxed">
        <code className="font-mono">
          <span className="block rounded bg-[#fb7185]/10 px-2 text-[#fb7185]">- import OpenAI from &quot;openai&quot;</span>
          <span className="block rounded bg-[#34d399]/10 px-2 text-[#34d399]">+ import {"{ OpenAI }"} from &quot;@prism-llm-labs/sdk&quot;</span>
          <span className="mt-2 block px-2 text-[var(--mk-muted)]">const openai = new OpenAI()</span>
        </code>
      </pre>
      <div className="flex flex-wrap gap-1.5 border-t p-3 mk-hairline">
        {provs.map((p) => (
          <span key={p} className="mk-chip px-2.5 py-1 text-[10px] text-[var(--mk-muted)]">{p}</span>
        ))}
      </div>
    </div>
  );
}

function ObserveViz() {
  const kpis = [
    { l: "Cost", v: "$48.2k", c: "var(--mk-gold)" },
    { l: "Requests", v: "3.1M", c: "var(--mk-sky)" },
    { l: "Error rate", v: "0.4%", c: "var(--mk-emerald)" },
  ];
  return (
    <div className="mk-card p-4">
      <div className="grid grid-cols-3 gap-2">
        {kpis.map((k) => (
          <div key={k.l} className="rounded-lg border bg-white/[0.02] p-2.5 mk-hairline">
            <div className="text-[10px] text-[var(--mk-faint)]">{k.l}</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums" style={{ color: k.c }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border bg-white/[0.02] p-2 mk-hairline">
        <MiniArea stroke="#a78bfa" fill="obs-area" />
      </div>
    </div>
  );
}

function FinOpsViz() {
  return (
    <div className="mk-card space-y-3 p-4">
      <div className="space-y-2.5">
        <Bar label="OpenAI" pct={64} color="var(--mk-violet)" value="$22.4k" />
        <Bar label="Anthropic" pct={40} color="var(--mk-sky)" value="$14.1k" />
        <Bar label="Google" pct={20} color="var(--mk-emerald)" value="$6.8k" />
      </div>
      <div className="rounded-lg border bg-white/[0.02] p-3 mk-hairline">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-[var(--mk-muted)]">Monthly budget · $50k</span>
          <span className="tabular-nums text-[var(--mk-gold)]">77%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full" style={{ width: "77%", background: "linear-gradient(90deg,#a78bfa,#facc15)" }} />
        </div>
      </div>
    </div>
  );
}

function GovernViz() {
  const rows = [
    { m: "gpt-4o", s: "Allow", c: "var(--mk-emerald)" },
    { m: "o1-preview", s: "Approval", c: "var(--mk-gold)" },
    { m: "deepseek-r1", s: "Block", c: "var(--mk-coral)" },
  ];
  return (
    <div className="mk-card p-4">
      <div className="mb-3 flex items-center justify-between rounded-lg border bg-white/[0.02] px-3 py-2.5 mk-hairline">
        <span className="text-xs text-[var(--mk-muted)]">Gateway coverage</span>
        <span className="text-lg font-semibold tabular-nums text-[var(--mk-emerald)]">96%</span>
      </div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.m} className="flex items-center justify-between rounded-lg border bg-white/[0.02] px-3 py-2 text-[12px] mk-hairline">
            <span className="font-mono text-[var(--mk-fg)]">{r.m}</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: r.c }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.c }} />
              {r.s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityViz() {
  return (
    <div className="mk-card p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-lg border bg-white/[0.02] px-3 py-2 mk-hairline">
          <div className="text-[10px] text-[var(--mk-faint)]">Pass rate</div>
          <div className="text-lg font-semibold tabular-nums text-[var(--mk-emerald)]">92%</div>
        </div>
        <div className="flex-1 rounded-lg border bg-white/[0.02] p-2 mk-hairline">
          <MiniArea stroke="#34d399" fill="q-area" />
        </div>
      </div>
      <div className="mt-3 rounded-lg border bg-white/[0.02] p-3 mk-hairline">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="text-[var(--mk-muted)]">Experiment vs baseline</span>
          <span className="rounded-full bg-[#34d399]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--mk-emerald)]">+6.2%</span>
        </div>
        <div className="space-y-2">
          <Bar label="baseline" pct={78} color="var(--mk-faint)" value="0.78" />
          <Bar label="candidate" pct={92} color="var(--mk-violet)" value="0.84" />
        </div>
      </div>
    </div>
  );
}

function OperateViz() {
  const alerts = [
    { t: "Budget · 80%", ch: "Email", c: "var(--mk-gold)" },
    { t: "Cost spike", ch: "Slack", c: "var(--mk-coral)" },
    { t: "PII detected", ch: "Webhook", c: "var(--mk-violet)" },
  ];
  return (
    <div className="mk-card p-4">
      <div className="space-y-2">
        {alerts.map((a) => (
          <div key={a.t} className="flex items-center justify-between rounded-lg border bg-white/[0.02] px-3 py-2 text-[12px] mk-hairline">
            <span className="inline-flex items-center gap-2 text-[var(--mk-fg)]">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.c }} />
              {a.t}
            </span>
            <span className="mk-chip px-2 py-0.5 text-[10px] text-[var(--mk-muted)]">{a.ch}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-lg border bg-white/[0.02] p-3 mk-hairline">
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--mk-violet)]" />
          <span className="text-[11px] text-[var(--mk-muted)]">Why did spend jump Tuesday?</span>
        </div>
        <div className="mt-2 flex items-start gap-2">
          <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--mk-sky)]" />
          <span className="text-[11px] text-[var(--mk-fg)]">
            A batch job on <span className="text-[var(--mk-violet)]">gpt-4o</span> added{" "}
            <span className="tabular-nums">$1,240</span> <ArrowRight className="inline h-3 w-3" /> see trace
          </span>
        </div>
      </div>
    </div>
  );
}

export function CategoryVisual({ kind }: { kind: VizKind }) {
  switch (kind) {
    case "capture": return <CaptureViz />;
    case "observe": return <ObserveViz />;
    case "finops": return <FinOpsViz />;
    case "govern": return <GovernViz />;
    case "quality": return <QualityViz />;
    case "operate": return <OperateViz />;
  }
}
