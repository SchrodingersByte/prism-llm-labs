import type { Metadata } from "next";
import Link from "next/link";
import { Section, SectionHeading } from "@/components/marketing/Section";
import { FaqAccordion } from "@/components/marketing/FaqAccordion";
import { FAQS } from "@/lib/marketing/content";

export const metadata: Metadata = {
  title: "FAQ — Prism",
  description:
    "Answers to common questions about Prism: pricing, providers, data security, SDK vs gateway, budgets, and getting started.",
};

export default function FaqPage() {
  return (
    <>
      <Section className="!pb-10 !pt-20">
        <SectionHeading
          eyebrow="FAQ"
          title={<>Frequently asked <span className="mk-grad-text italic">questions</span></>}
          description="Everything you need to know about Prism. Can't find an answer? We're a message away."
        />
      </Section>

      <Section className="!pt-0">
        <FaqAccordion items={FAQS} />

        <div className="mx-auto mt-12 max-w-3xl rounded-2xl border mk-hairline p-8 text-center">
          <h3 className="font-playfair text-xl font-semibold text-[var(--mk-fg)]">Still have questions?</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-[var(--mk-muted)]">
            Talk to the team — we&apos;ll help you map Prism to your stack and your spend.
          </p>
          <Link
            href="/contact"
            className="mk-btn-primary mt-5 inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Contact us
          </Link>
        </div>
      </Section>
    </>
  );
}
