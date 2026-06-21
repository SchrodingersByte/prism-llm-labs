import type { Metadata } from "next";
import { Section, SectionHeading } from "@/components/marketing/Section";
import { PricingCards, PricingMatrix } from "@/components/marketing/PricingTable";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { CtaBand } from "@/components/marketing/CtaBand";
import { FAQS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "Pricing — Prism",
  description:
    "Simple, event-metered pricing. Free forever within quota, then Pro, Team, and Enterprise. Priced on telemetry events, not seats.",
};

// Pricing-relevant questions, pulled from the shared FAQ source.
const PRICING_FAQ = FAQS.filter((f) =>
  ["How does pricing work?", "What counts as an event?", "Can I enforce budgets and spend caps?", "Is there a free trial?"].includes(f.q)
);

export default function PricingPage() {
  return (
    <>
      <Section className="!pb-10 !pt-20">
        <SectionHeading
          eyebrow="Pricing"
          title={<>Priced on <span className="mk-grad-text italic">events</span>, not seats</>}
          description="Bring your whole team at no per-head cost. Start free, and only pay as your telemetry volume grows."
        />
      </Section>

      <Section className="!pt-0">
        <PricingCards />
        <p className="mt-6 text-center text-xs text-[var(--mk-faint)]">
          All paid plans include a 14-day trial. Prices in USD, billed monthly.
        </p>
      </Section>

      <Section className="!pt-0">
        <SectionHeading title="Compare every plan" align="center" />
        <div className="mt-10">
          <PricingMatrix />
        </div>
      </Section>

      <Section className="!pt-0">
        <SectionHeading eyebrow="Pricing FAQ" title="The fine print, in plain words" />
        <div className="mt-12">
          <FaqAccordion items={PRICING_FAQ} />
        </div>
      </Section>

      <Section className="!pt-0">
        <CtaBand
          title="Try every feature free."
          description="Spin up a workspace, install the SDK, and watch your first events land — no credit card required."
          primary={{ label: "Start for free", href: "/signup" }}
          secondary={{ label: "Contact sales", href: "/contact" }}
        />
      </Section>
    </>
  );
}
