import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Hero } from "@/components/marketing/Hero";
import { Section, SectionHeading } from "@/components/marketing/Section";
import { FeatureGrid, FeatureSpotlight } from "@/components/marketing/FeatureSection";
import { StepFlow } from "@/components/marketing/StepFlow";
import { PricingCards } from "@/components/marketing/PricingTable";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { CtaBand } from "@/components/marketing/CtaBand";
import { FEATURES, FAQS, PROVIDERS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Prism — AI FinOps & LLM Cost Observability",
  description:
    "Track, govern, and optimize LLM spend across 16+ providers. Drop-in SDKs, an optional policy gateway, real-time unit economics, and FinOps chargeback.",
};

function GatewayViz() {
  const provs = ["OpenAI", "Anthropic", "Google", "Bedrock", "Mistral", "Groq"];
  return (
    <div className="mk-card p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col items-center gap-2">
          <span className="rounded-xl border mk-hairline bg-white/[0.03] px-3 py-2.5 text-xs font-medium text-[var(--mk-fg)]">
            Your app
          </span>
          <span className="text-[10px] text-[var(--mk-faint)]">any SDK</span>
        </div>

        <ArrowRight className="h-5 w-5 shrink-0 text-[var(--mk-faint)]" />

        <div className="flex flex-col items-center gap-2">
          <span
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-black"
            style={{ background: "linear-gradient(135deg,#a78bfa,#8b5cf6)" }}
          >
            Prism
          </span>
          <span className="text-[10px] text-[var(--mk-violet)]">policy · fallback · capture</span>
        </div>

        <ArrowRight className="h-5 w-5 shrink-0 text-[var(--mk-faint)]" />

        <div className="grid grid-cols-2 gap-1.5">
          {provs.map((p) => (
            <span key={p} className="rounded-lg border mk-hairline bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-[var(--mk-muted)]">
              {p}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-6 border-t pt-4 text-center text-xs text-[var(--mk-faint)] mk-hairline">
        One OpenAI-compatible endpoint. Switch providers without touching call sites.
      </p>
    </div>
  );
}

export default function LandingPage() {
  const gateway = FEATURES.find((f) => f.id === "gateway")!;
  const rest = FEATURES.filter((f) => f.id !== "gateway");

  return (
    <>
      <Hero />

      {/* Providers */}
      <Section className="!py-14">
        <p className="text-center text-xs font-medium uppercase tracking-wider text-[var(--mk-faint)]">
          Works with every major provider — and your own endpoints
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
          {PROVIDERS.map((p) => (
            <span key={p} className="mk-chip px-3 py-1.5 text-[var(--mk-muted)]">
              {p}
            </span>
          ))}
        </div>
      </Section>

      {/* Features */}
      <Section id="features">
        <SectionHeading
          eyebrow="Everything in one platform"
          title="From a single call to full financial control"
          description="Prism captures every model and tool call, then turns it into observability, governance, and unit economics your whole org can act on."
        />
        <div className="mt-14">
          <FeatureSpotlight feature={gateway} visual={<GatewayViz />} />
        </div>
        <div className="mt-16">
          <FeatureGrid features={rest} />
        </div>
        <div className="mt-10 text-center">
          <Link href="/features" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            Explore every feature in depth <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" className="!pt-0">
        <SectionHeading
          eyebrow="How it works"
          title="Live in minutes, not a migration"
          description="No infrastructure to deploy. Add the SDK, and choose direct telemetry or the policy gateway — same code either way."
        />
        <div className="mt-14">
          <StepFlow />
        </div>
        <div className="mt-8 text-center">
          <Link href="/how-it-works" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            See the full architecture <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Section>

      {/* Pricing preview */}
      <Section id="pricing">
        <SectionHeading
          eyebrow="Pricing"
          title="Priced on events, not seats"
          description="Add your whole team without per-head fees. Start free, scale when your telemetry does."
        />
        <div className="mt-14">
          <PricingCards />
        </div>
        <div className="mt-8 text-center">
          <Link href="/pricing" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            Compare all plans <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Section>

      {/* FAQ preview */}
      <Section className="!pt-0">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="mt-12">
          <FaqAccordion items={FAQS.slice(0, 5)} />
        </div>
        <div className="mt-8 text-center">
          <Link href="/faq" className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            Read all FAQs <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Section>

      {/* CTA */}
      <Section className="!pt-0">
        <CtaBand />
      </Section>
    </>
  );
}
