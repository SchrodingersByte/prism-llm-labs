import type { Metadata } from "next";
import { ArrowRight, ArrowDown, Boxes, Cpu, Database, LayoutDashboard } from "lucide-react";
import { Section, SectionHeading } from "@/components/marketing/Section";
import { StepFlow } from "@/components/marketing/StepFlow";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "How it works — Prism",
  description:
    "How Prism captures LLM telemetry: SDK mode vs gateway mode, the analytics pipeline, and inline governance — from your first call to your dashboard.",
};

const STAGES = [
  { icon: Boxes, title: "Your app", sub: "Any LLM SDK", color: "var(--mk-sky)" },
  { icon: Cpu, title: "Capture", sub: "SDK or gateway", color: "var(--mk-violet)" },
  { icon: Database, title: "Pipeline", sub: "Columnar analytics", color: "var(--mk-emerald)" },
  { icon: LayoutDashboard, title: "Dashboard", sub: "Spend & governance", color: "var(--mk-gold)" },
];

const GOVERNANCE = [
  "Rate limit",
  "Spend caps",
  "Gateway-only mode",
  "Data residency",
  "Model governance",
  "Soft-cap downgrade",
  "Model allowlist",
  "Capability guard",
  "Content guardrails",
];

export default function HowItWorksPage() {
  return (
    <>
      <Section className="!pb-10 !pt-20">
        <SectionHeading
          eyebrow="How it works"
          title={<>From one call to <span className="mk-grad-text italic">full control</span></>}
          description="Prism sits exactly where you want it — in your process, or on the request path — and turns every call into analytics, governance, and unit economics."
        />
      </Section>

      {/* Pipeline */}
      <Section className="!pt-0">
        <div className="mk-card p-6 sm:p-10">
          <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-center lg:justify-between">
            {STAGES.map((s, i) => {
              const Icon = s.icon;
              return (
                <div key={s.title} className="flex flex-col items-stretch gap-4 lg:flex-1 lg:flex-row lg:items-center">
                  <div className="flex flex-1 flex-col items-center gap-2 rounded-xl border mk-hairline bg-white/[0.02] px-4 py-5 text-center">
                    <span
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg"
                      style={{ color: s.color, background: "color-mix(in srgb, currentColor 14%, transparent)" }}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-semibold text-[var(--mk-fg)]">{s.title}</span>
                    <span className="text-xs text-[var(--mk-faint)]">{s.sub}</span>
                  </div>
                  {i < STAGES.length - 1 && (
                    <>
                      <ArrowRight className="mx-auto hidden h-5 w-5 shrink-0 text-[var(--mk-faint)] lg:block" />
                      <ArrowDown className="mx-auto h-5 w-5 shrink-0 text-[var(--mk-faint)] lg:hidden" />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* Two modes */}
      <Section className="!pt-0">
        <SectionHeading
          eyebrow="Two telemetry paths"
          title="Direct, or on the request path"
          description="Same one-line integration. Choose how the data flows."
        />
        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          <div className="mk-card p-6">
            <h3 className="text-lg font-semibold text-[var(--mk-fg)]">SDK mode</h3>
            <p className="mt-1 text-sm text-[var(--mk-violet)]">Default · zero added latency on the wire</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--mk-muted)]">
              The SDK wraps your client in-process, checks your budget, captures the response, and
              ships telemetry directly. Your provider traffic never routes through Prism — ideal
              when you want observability with nothing in the request path.
            </p>
          </div>
          <div className="mk-card p-6">
            <h3 className="text-lg font-semibold text-[var(--mk-fg)]">Gateway mode</h3>
            <p className="mt-1 text-sm text-[var(--mk-violet)]">Opt-in · inline policy enforcement</p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--mk-muted)]">
              Set <code className="rounded bg-white/5 px-1 font-mono text-[12px] text-[var(--mk-fg)]">PRISM_GATEWAY_URL</code>{" "}
              and calls route through the gateway, which authenticates your key, enforces policy,
              applies fallbacks and guardrails, then proxies to the provider — all before the model
              sees the request.
            </p>
          </div>
        </div>
      </Section>

      {/* Governance order */}
      <Section className="!pt-0">
        <SectionHeading
          eyebrow="Inline governance"
          title="Every gateway request, evaluated in order"
          description="Policies run as a pipeline before the call reaches the provider. Anything that fails is blocked, downgraded, or redacted — by your rules."
        />
        <div className="mx-auto mt-12 max-w-3xl">
          <div className="flex flex-wrap items-center justify-center gap-2">
            {GOVERNANCE.map((g, i) => (
              <div key={g} className="flex items-center gap-2">
                <span className="mk-chip px-3 py-1.5 text-[var(--mk-muted)]">
                  <span className="font-mono text-[10px] text-[var(--mk-violet)]">{i + 1}</span>
                  {g}
                </span>
                {i < GOVERNANCE.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-[var(--mk-faint)]" />}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* Steps */}
      <Section className="!pt-0">
        <SectionHeading eyebrow="Get started" title="Three steps to live telemetry" />
        <div className="mt-12">
          <StepFlow />
        </div>
      </Section>

      <Section className="!pt-0">
        <CtaBand />
      </Section>
    </>
  );
}
