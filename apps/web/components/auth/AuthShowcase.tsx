"use client";

import { useEffect, useState } from "react";
import { Pause, Play } from "lucide-react";
import { Logo } from "@/components/marketing/Logo";
import { ACCENT_VAR } from "@/components/marketing/Section";
import {
  SCENES, MODE_LABEL,
  type Scene, type ShowcaseMode, type Tier,
  type ShowcaseBar, type ShowcaseStat, type GovRow,
} from "@/lib/marketing/showcase";
import { cn } from "@/lib/utils";

const ROTATE_MS = 5200;
const FEATURE_ACCENTS = ["violet", "sky", "emerald"] as const;

// ── tier badge ────────────────────────────────────────────────────────────────
const TIER_CLS: Record<Tier, string> = {
  Free: "border-white/15 text-[var(--mk-faint)]",
  Pro: "border-[#a78bfa]/45 text-[var(--mk-violet)]",
  Enterprise: "border-[#facc15]/45 text-[var(--mk-gold)]",
};
function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={cn("rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide", TIER_CLS[tier])}>
      {tier}
    </span>
  );
}

// ── mini visuals (data-driven) ────────────────────────────────────────────────
function SpendBars({ bars }: { bars: ShowcaseBar[] }) {
  return (
    <div className="space-y-3">
      {bars.map((b) => (
        <div key={b.label}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="text-[var(--mk-fg)]">{b.label}</span>
            <span className="tabular-nums text-[var(--mk-faint)]">{b.pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full" style={{ width: `${b.pct}%`, background: ACCENT_VAR[b.accent] }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Efficiency({ stats }: { stats: ShowcaseStat[] }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border mk-hairline bg-white/[0.02] p-2.5">
            <div className="text-[10px] text-[var(--mk-faint)]">{s.label}</div>
            <div className="mt-0.5 text-base font-semibold tabular-nums" style={{ color: ACCENT_VAR[s.accent] }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 320 70" className="mt-3 h-16 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="eff-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0,52 C50,48 70,30 110,34 C160,39 180,18 230,22 C270,25 300,12 320,10 L320,70 L0,70 Z" fill="url(#eff-area)" />
        <path d="M0,52 C50,48 70,30 110,34 C160,39 180,18 230,22 C270,25 300,12 320,10" fill="none" stroke="#34d399" strokeWidth="2" />
      </svg>
    </div>
  );
}

function Sessions() {
  const rows = [
    { label: "gpt-4o", offset: 0, width: 58, color: "var(--mk-violet)" },
    { label: "tool: search", offset: 16, width: 30, color: "var(--mk-sky)" },
    { label: "embed", offset: 30, width: 16, color: "var(--mk-emerald)" },
    { label: "gpt-4o", offset: 44, width: 40, color: "var(--mk-violet)" },
    { label: "tool: write", offset: 70, width: 24, color: "var(--mk-gold)" },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-[11px]">
          <span className="w-[72px] shrink-0 truncate text-[var(--mk-muted)]">{r.label}</span>
          <div className="relative h-2.5 flex-1 rounded bg-white/5">
            <div className="absolute h-full rounded" style={{ left: `${r.offset}%`, width: `${r.width}%`, background: r.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

const GOV_STYLE: Record<GovRow["status"], { label: string; color: string }> = {
  allow: { label: "Allow", color: "var(--mk-emerald)" },
  block: { label: "Block", color: "var(--mk-coral)" },
  approve: { label: "Approval", color: "var(--mk-gold)" },
};
function Governance({ rows }: { rows: GovRow[] }) {
  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const s = GOV_STYLE[r.status];
        return (
          <div key={r.label} className="flex items-center justify-between rounded-lg border mk-hairline bg-white/[0.02] px-3 py-2 text-[12px]">
            <span className="font-mono text-[var(--mk-fg)]">{r.label}</span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: s.color }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Budget({ stats, pct }: { stats: ShowcaseStat[]; pct: number }) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border mk-hairline bg-white/[0.02] p-3">
            <div className="text-[10px] text-[var(--mk-faint)]">{s.label}</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums" style={{ color: ACCENT_VAR[s.accent] }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between text-[11px]">
          <span className="text-[var(--mk-muted)]">Monthly budget</span>
          <span className="tabular-nums text-[var(--mk-faint)]">{pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-white/5">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#a78bfa,#facc15)" }} />
        </div>
      </div>
    </div>
  );
}

function Visual({ scene }: { scene: Scene }) {
  switch (scene.visual) {
    case "spend-bars": return <SpendBars bars={scene.bars ?? []} />;
    case "efficiency": return <Efficiency stats={scene.stats ?? []} />;
    case "sessions": return <Sessions />;
    case "governance": return <Governance rows={scene.rows ?? []} />;
    case "budget": return <Budget stats={scene.stats ?? []} pct={scene.budgetPct ?? 0} />;
  }
}

// ── avatars (social proof) ────────────────────────────────────────────────────
const AVATARS = [
  { initials: "AK", from: "#a78bfa", to: "#8b5cf6" },
  { initials: "JR", from: "#38bdf8", to: "#0ea5e9" },
  { initials: "MN", from: "#34d399", to: "#059669" },
  { initials: "TS", from: "#facc15", to: "#eab308" },
];

// ── main ──────────────────────────────────────────────────────────────────────
export function AuthShowcase() {
  const [mode, setMode] = useState<ShowcaseMode>("solo");
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);

  const scenes = SCENES[mode];
  const scene = scenes[index] ?? scenes[0];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing || hovered) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % scenes.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [playing, hovered, index, scenes.length]);

  function changeMode(m: ShowcaseMode) {
    if (m === mode) return;
    setMode(m);
    setIndex(0);
  }

  return (
    <div
      className="marketing relative flex h-full w-full flex-col overflow-hidden p-8 lg:p-12"
      style={{
        backgroundColor: "#09090f",
        backgroundImage:
          "radial-gradient(900px 500px at 80% -10%, rgba(139,92,246,0.28), transparent 60%), radial-gradient(700px 500px at 0% 110%, rgba(56,189,248,0.12), transparent 55%)",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="pointer-events-none absolute -right-20 top-1/3 h-72 w-72 rounded-full bg-[#a78bfa]/20 blur-3xl" />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between">
        <Logo href={null} wordmarkClassName="text-[var(--mk-fg)]" />
        <div className="inline-flex rounded-full border mk-hairline bg-white/[0.03] p-0.5 text-xs">
          {(["solo", "team"] as ShowcaseMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              className={cn(
                "rounded-full px-3 py-1.5 font-medium transition-colors",
                mode === m ? "bg-white/10 text-[var(--mk-fg)]" : "text-[var(--mk-muted)] hover:text-[var(--mk-fg)]"
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {/* Scene */}
      <div className="relative z-10 flex flex-1 flex-col justify-center py-10">
        <div key={`${mode}-${index}`} className="animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
          <p className="mk-eyebrow">{scene.eyebrow}</p>
          <h2 className="mt-3 font-playfair text-3xl font-semibold leading-tight text-[var(--mk-fg)] lg:text-4xl">
            {scene.lead} <span className="mk-grad-text italic">{scene.accent}</span>
          </h2>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-[var(--mk-muted)]">{scene.subtitle}</p>

          <div className="mt-7 grid gap-5 lg:grid-cols-2">
            <div className="space-y-3.5">
              {scene.features.map((f, i) => {
                const color = ACCENT_VAR[FEATURE_ACCENTS[i % FEATURE_ACCENTS.length]];
                const Icon = f.icon;
                return (
                  <div key={f.title} className="flex items-start gap-3">
                    <span
                      className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                      style={{ color, background: "color-mix(in srgb, currentColor 14%, transparent)" }}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[var(--mk-fg)]">{f.title}</span>
                        <TierBadge tier={f.badge} />
                      </div>
                      <p className="text-xs text-[var(--mk-muted)]">{f.desc}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mk-card p-4">
              <Visual scene={scene} />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border mk-hairline text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-fg)]"
            aria-label={playing ? "Pause auto-play" : "Resume auto-play"}
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <span className="text-xs text-[var(--mk-faint)]">
            Auto-play {playing ? "playing" : "paused"}
          </span>
          <div className="ml-1 flex items-center gap-1.5">
            {scenes.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Go to slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-[var(--mk-violet)]" : "w-1.5 bg-white/20 hover:bg-white/40"
                )}
              />
            ))}
          </div>
        </div>

        <div className="hidden items-center gap-3 sm:flex">
          <div className="flex -space-x-2">
            {AVATARS.map((a) => (
              <span
                key={a.initials}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#09090f] text-[10px] font-semibold text-black"
                style={{ background: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
              >
                {a.initials}
              </span>
            ))}
          </div>
          <span className="text-xs text-[var(--mk-muted)]">Join 1,200+ teams</span>
        </div>
      </div>
    </div>
  );
}
