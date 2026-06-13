"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// ── Plan definitions ──────────────────────────────────────────────────────────

const PLANS = [
  {
    id: "developer" as const,
    label: "Developer",
    badge: "$19 / mo",
    tagline: "For individual developers",
    perks: ["1 seat", "Unlimited projects", "Core analytics + governance", "Community support"],
  },
  {
    id: "startup" as const,
    label: "Startup",
    badge: "$29 / mo",
    tagline: "For growing teams",
    perks: ["Up to 10 seats", "Teams & attribution", "Full analytics + governance", "Priority support"],
  },
];

// ── Animated wave SVG (left panel) ───────────────────────────────────────────

function WaveCanvas() {
  const waves = [
    { color: "#6366f1", offset: 0,    duration: 8,   amplitude: 60,  yBase: 55 },
    { color: "#06b6d4", offset: 120,  duration: 10,  amplitude: 45,  yBase: 62 },
    { color: "#8b5cf6", offset: 60,   duration: 12,  amplitude: 70,  yBase: 70 },
    { color: "#10b981", offset: 200,  duration: 9,   amplitude: 50,  yBase: 78 },
    { color: "#f59e0b", offset: 40,   duration: 11,  amplitude: 40,  yBase: 85 },
    { color: "#f43f5e", offset: 160,  duration: 7.5, amplitude: 30,  yBase: 91 },
  ];

  // Build SVG path for a sine wave spanning the full width
  function sinePath(amplitude: number, yBase: number, phaseOffset: number) {
    const W = 700;
    const H = 400;
    const cy = (yBase / 100) * H;
    const freq = (2 * Math.PI) / 200;
    const points: string[] = [];
    for (let x = -10; x <= W + 10; x += 4) {
      const y = cy + amplitude * Math.sin(freq * x + phaseOffset);
      points.push(x === -10 ? `M${x},${y}` : `L${x},${y}`);
    }
    return points.join(" ");
  }

  return (
    <svg
      viewBox="0 0 700 400"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 0.7 }}
    >
      {waves.map((w, i) => (
        <path
          key={i}
          d={sinePath(w.amplitude, w.yBase, w.offset * 0.02)}
          fill="none"
          stroke={w.color}
          strokeWidth={1.8}
          strokeLinecap="round"
          style={{
            animation: `waveShift ${w.duration}s ease-in-out infinite alternate`,
            transformOrigin: "50% 50%",
          }}
        />
      ))}
      <style>{`
        @keyframes waveShift {
          0%   { transform: translateX(-30px) scaleY(0.9); }
          100% { transform: translateX(30px)  scaleY(1.1); }
        }
      `}</style>
    </svg>
  );
}

// ── Plan card ────────────────────────────────────────────────────────────────

function PlanCard({
  plan,
  selected,
  onSelect,
}: {
  plan: (typeof PLANS)[number];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left w-full p-4 rounded-xl border-2 transition-all duration-150"
      style={{
        borderColor: selected ? "var(--ink-900)" : "var(--ink-100)",
        background:  selected ? "#f8f9ff" : "white",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold" style={{ color: "var(--ink-900)" }}>
          {plan.label}
        </span>
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
          style={{
            background: selected ? "var(--ink-900)" : "var(--ink-100)",
            color:      selected ? "white"           : "var(--ink-500)",
          }}
        >
          {plan.badge}
        </span>
      </div>
      <p className="text-xs mb-2.5" style={{ color: "var(--ink-500)" }}>{plan.tagline}</p>
      <ul className="space-y-1">
        {plan.perks.map(p => (
          <li key={p} className="flex items-center gap-1.5">
            <svg className="h-3 w-3 shrink-0" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke={selected ? "#0f1117" : "#9ca3af"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="text-[11px]" style={{ color: selected ? "var(--ink-700)" : "var(--ink-300)" }}>
              {p}
            </span>
          </li>
        ))}
      </ul>
    </button>
  );
}

// ── Form (needs useSearchParams → Suspense boundary) ─────────────────────────

function OnboardingForm() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const redirectTo   = searchParams.get("next") ?? "/dashboard";

  const [email,     setEmail]     = useState("");
  const [fullName,  setFullName]  = useState("");
  const [orgName,   setOrgName]   = useState("");
  const [plan,      setPlan]      = useState<"developer" | "startup">("developer");
  const [marketing, setMarketing] = useState(false);
  const [tos,       setTos]       = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState("");
  const [ready,     setReady]     = useState(false); // wait for session

  const supabase = createClient();

  // Load user session and pre-fill fields
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setEmail(user.email ?? "");
      // OAuth providers surface name in different metadata fields
      const name =
        user.user_metadata?.full_name ??
        user.user_metadata?.name ??
        user.user_metadata?.user_name ??
        "";
      setFullName(name);
      setReady(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tos) return;
    setLoading(true);
    setError("");

    const res = await fetch("/api/onboarding/setup", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        org_name:          orgName.trim(),
        full_name:         fullName.trim() || undefined,
        plan,
        marketing_consent: marketing,
        tos_accepted:      true,          // button is disabled until tos=true, so this is always true here
      }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json?.error?.fieldErrors?.org_name?.[0] ?? json?.error ?? "Something went wrong. Please try again.");
      setLoading(false);
      return;
    }

    router.push(redirectTo);
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="w-full max-w-[380px] mx-auto flex items-center justify-center h-40">
        <div className="h-6 w-6 border-2 border-[var(--ink-300)] border-t-[var(--ink-900)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px] mx-auto">
      {/* Logo */}
      <div className="flex items-center gap-2 mb-7">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-white text-xs font-black shrink-0"
          style={{ background: "var(--ink-900)" }}
        >
          P
        </span>
        <span className="text-sm font-semibold tracking-tight" style={{ color: "var(--ink-900)" }}>
          Prism
        </span>
      </div>

      {/* Heading */}
      <h1 className="text-[1.75rem] leading-tight mb-1" style={{ color: "var(--ink-900)" }}>
        <span className="font-light italic">Set up your </span>
        <span className="font-black">account.</span>
      </h1>
      <p className="text-sm mb-7" style={{ color: "var(--ink-300)" }}>
        A few quick details and you're ready to go.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">

        {/* Email — read-only */}
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            readOnly
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
            style={{ background: "#f9fafb", color: "var(--ink-500)", cursor: "default" }}
          />
        </div>

        {/* Full name — read-only, sourced from OAuth provider */}
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Full name
          </label>
          <input
            type="text"
            value={fullName}
            readOnly
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
            style={{ background: "#f9fafb", color: "var(--ink-500)", cursor: "default" }}
          />
        </div>

        {/* Organisation name — required */}
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--ink-700)" }}>
            Organisation name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={orgName}
            onChange={e => setOrgName(e.target.value)}
            required
            autoComplete="off"
            className="input-brand w-full px-3 py-2.5 rounded-lg text-sm"
          />
        </div>

        {/* Plan selection */}
        <div>
          <label className="block text-xs font-medium mb-2" style={{ color: "var(--ink-700)" }}>
            Choose your plan
          </label>
          <div className="grid grid-cols-2 gap-2.5">
            {PLANS.map(p => (
              <PlanCard
                key={p.id}
                plan={p}
                selected={plan === p.id}
                onSelect={() => setPlan(p.id)}
              />
            ))}
          </div>
        </div>

        {/* Checkboxes */}
        <div className="flex flex-col gap-3 pt-0.5">
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <div className="mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={marketing}
                onChange={e => setMarketing(e.target.checked)}
                className="h-3.5 w-3.5 rounded border accent-[var(--ink-900)]"
                style={{ marginTop: "1px" }}
              />
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--ink-500)" }}>
              Keep me updated on Prism features, product releases, and tips.
            </span>
          </label>

          <label className="flex items-start gap-2.5 cursor-pointer">
            <div className="mt-0.5 shrink-0">
              <input
                type="checkbox"
                checked={tos}
                onChange={e => setTos(e.target.checked)}
                required
                className="h-3.5 w-3.5 rounded border accent-[var(--ink-900)]"
                style={{ marginTop: "1px" }}
              />
            </div>
            <span className="text-xs leading-relaxed" style={{ color: "var(--ink-500)" }}>
              I agree to the{" "}
              <a href="/terms" className="nav-link font-medium" target="_blank" rel="noopener noreferrer">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="/privacy" className="nav-link font-medium" target="_blank" rel="noopener noreferrer">
                Privacy Policy
              </a>
              .
            </span>
          </label>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || !tos || !orgName.trim()}
          className="btn-primary flex items-center justify-center gap-1.5 w-full py-2.5 rounded-lg text-sm font-semibold mt-1"
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Setting up…
            </>
          ) : (
            <>Continue <span aria-hidden>→</span></>
          )}
        </button>
      </form>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen">

      {/* ── Left panel — 65%, dark with animated waves ────────────────────── */}
      <div
        className="hidden md:flex flex-1 flex-col justify-between px-12 py-12 relative overflow-hidden"
        style={{ background: "#07080d" }}
      >
        {/* Background waves */}
        <WaveCanvas />

        {/* Content — above waves */}
        <div className="relative z-10">
          <div className="flex items-center gap-2.5 mb-16">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-full text-white text-sm font-black"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              P
            </span>
            <span className="text-white/90 text-[15px] font-semibold tracking-tight">Prism</span>
          </div>

          <h2 className="text-white text-4xl font-black leading-tight max-w-xs mb-5">
            The LLM<br />observability<br />platform.
          </h2>
          <p className="text-white/50 text-sm max-w-[280px] leading-relaxed">
            Track spend, govern access, and optimise cost across every model, provider, and team — all in one place.
          </p>
        </div>

        {/* Bottom caption */}
        <div className="relative z-10">
          <p className="text-white/25 text-xs">
            © {new Date().getFullYear()} Prism Labs. All rights reserved.
          </p>
        </div>
      </div>

      {/* ── Right panel — 35%, white form ─────────────────────────────────── */}
      <div className="
        relative flex flex-col justify-center
        w-full md:w-[38%] md:min-w-[400px] md:max-w-[540px]
        bg-white border-l border-l-[var(--ink-100)]
        px-8 sm:px-12 py-12
        overflow-y-auto
      ">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-40">
              <div className="h-6 w-6 border-2 border-[var(--ink-300)] border-t-[var(--ink-900)] rounded-full animate-spin" />
            </div>
          }
        >
          <OnboardingForm />
        </Suspense>
      </div>

    </div>
  );
}
