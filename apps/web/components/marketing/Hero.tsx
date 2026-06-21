import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { STATS } from "@/lib/marketing/content";

function HeroPreview() {
  const kpis = [
    { label: "Monthly spend", value: "$48.2k", delta: "+12%", color: "var(--mk-gold)" },
    { label: "Requests", value: "3.1M", delta: "+8%", color: "var(--mk-sky)" },
    { label: "Tokens", value: "1.4B", delta: "+5%", color: "var(--mk-violet)" },
    { label: "Error rate", value: "0.4%", delta: "−0.2%", color: "var(--mk-emerald)" },
  ];
  const projects = [
    { name: "prism-api", pct: 42, color: "var(--mk-violet)" },
    { name: "support-bot", pct: 28, color: "var(--mk-sky)" },
    { name: "search-rag", pct: 18, color: "var(--mk-emerald)" },
    { name: "batch-jobs", pct: 12, color: "var(--mk-gold)" },
  ];

  return (
    <div className="mk-card relative overflow-hidden p-3 shadow-2xl sm:p-4">
      {/* window chrome */}
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#fb7185]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#facc15]/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#34d399]/70" />
        <span className="ml-3 text-xs text-[var(--mk-faint)]">Command Center</span>
        <span className="mk-chip ml-auto px-2 py-0.5 text-[10px]">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--mk-emerald)]" />
          Live
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* KPI tiles + trend */}
        <div className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-xl border mk-hairline bg-white/[0.02] p-3">
                <div className="text-[10px] uppercase tracking-wide text-[var(--mk-faint)]">{k.label}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-[var(--mk-fg)]">{k.value}</div>
                <div className="mt-0.5 text-[11px] tabular-nums" style={{ color: k.color }}>{k.delta}</div>
              </div>
            ))}
          </div>

          <div className="mt-3 rounded-xl border mk-hairline bg-white/[0.02] p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-[var(--mk-muted)]">Spend trend · 30d</span>
              <span className="text-xs tabular-nums text-[var(--mk-faint)]">$1.6k/day</span>
            </div>
            <svg viewBox="0 0 560 150" className="h-28 w-full" preserveAspectRatio="none">
              <defs>
                <linearGradient id="hero-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path
                d="M0,120 C60,110 90,80 140,86 C190,92 220,60 280,66 C340,72 370,38 430,46 C480,52 520,28 560,24 L560,150 L0,150 Z"
                fill="url(#hero-area)"
              />
              <path
                d="M0,120 C60,110 90,80 140,86 C190,92 220,60 280,66 C340,72 370,38 430,46 C480,52 520,28 560,24"
                fill="none"
                stroke="#a78bfa"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        {/* Spend by project */}
        <div className="rounded-xl border mk-hairline bg-white/[0.02] p-3">
          <div className="mb-3 text-xs text-[var(--mk-muted)]">Spend by project</div>
          <div className="space-y-3">
            {projects.map((p) => (
              <div key={p.name}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="text-[var(--mk-fg)]">{p.name}</span>
                  <span className="tabular-nums text-[var(--mk-faint)]">{p.pct}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                  <div className="h-full rounded-full" style={{ width: `${p.pct}%`, background: p.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-20 sm:pt-28">
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <span className="mk-chip px-3 py-1 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-[var(--mk-violet)]" />
            AI FinOps for every LLM you ship
          </span>

          <h1 className="mt-6 font-playfair text-4xl font-semibold leading-[1.08] tracking-tight text-[var(--mk-fg)] sm:text-6xl">
            Your LLM spend,{" "}
            <span className="mk-grad-text italic">made visible.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[var(--mk-muted)]">
            Track, govern, and optimize every model call across 16+ providers — with
            drop-in SDKs, an optional policy gateway, and real-time unit economics.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/signup"
              className="mk-btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-6 py-3 text-sm font-semibold"
            >
              Start for free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/docs"
              className="mk-btn-ghost inline-flex items-center justify-center rounded-lg px-6 py-3 text-sm font-semibold"
            >
              Read the docs
            </Link>
          </div>

          <p className="mt-4 text-xs text-[var(--mk-faint)]">
            Free forever within quota · No credit card required
          </p>
        </div>

        {/* Product preview */}
        <div className="relative mx-auto mt-14 max-w-5xl">
          <div className="pointer-events-none absolute -inset-x-10 -top-10 h-40 bg-[radial-gradient(closest-side,rgba(139,92,246,0.25),transparent)]" />
          <div className="relative">
            <HeroPreview />
          </div>
        </div>

        {/* Stat band */}
        <dl className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-6 sm:grid-cols-4">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <dt className="font-playfair text-3xl font-semibold text-[var(--mk-fg)]">{s.value}</dt>
              <dd className="mt-1 text-sm text-[var(--mk-muted)]">{s.label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
