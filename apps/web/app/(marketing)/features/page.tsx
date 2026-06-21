import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Section, SectionHeading, ACCENT_VAR } from "@/components/marketing/Section";
import { CategoryVisual } from "@/components/marketing/FeatureVisuals";
import { CtaBand } from "@/components/marketing/CtaBand";
import { FEATURE_CATEGORIES } from "@/lib/marketing/content";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Features — Prism",
  description:
    "Everything Prism does: a universal LLM gateway, drop-in SDKs, real-time cost observability, FinOps chargeback, governance & guardrails, quality evals, and agent analytics.",
};

export default function FeaturesPage() {
  return (
    <>
      {/* Hero */}
      <Section className="!pb-12 !pt-20">
        <SectionHeading
          eyebrow="Features"
          title={<>Everything you need to <span className="mk-grad-text italic">run LLMs in production</span></>}
          description="From the first model call to full financial control — capture, observe, govern, optimize, and grow, in one platform."
        />

        {/* Category jump-nav */}
        <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-2.5">
          {FEATURE_CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <a
                key={c.id}
                href={`#${c.id}`}
                className="mk-chip px-3.5 py-2 text-sm text-[var(--mk-muted)] transition-colors hover:text-[var(--mk-fg)]"
              >
                <Icon className="h-4 w-4" style={{ color: ACCENT_VAR[c.accent] }} />
                {c.title}
              </a>
            );
          })}
        </div>
      </Section>

      {/* Category spotlights */}
      {FEATURE_CATEGORIES.map((cat, i) => {
        const Icon = cat.icon;
        const color = ACCENT_VAR[cat.accent];
        const flip = i % 2 === 1;
        return (
          <Section key={cat.id} id={cat.id} className="!pt-0">
            <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-14">
              {/* Copy + capabilities */}
              <div className={cn(flip && "lg:order-2")}>
                <div
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ color, background: "color-mix(in srgb, currentColor 14%, transparent)" }}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-5 font-playfair text-2xl font-semibold tracking-tight text-[var(--mk-fg)] sm:text-3xl">
                  {cat.title}
                </h2>
                <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--mk-muted)]">{cat.intro}</p>

                <ul className="mt-7 space-y-4">
                  {cat.capabilities.map((c) => (
                    <li key={c.name} className="flex gap-3">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <div>
                        <div className="text-sm font-semibold text-[var(--mk-fg)]">{c.name}</div>
                        <div className="text-sm leading-relaxed text-[var(--mk-muted)]">{c.desc}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Visual */}
              <div className={cn(flip && "lg:order-1")}>
                <div className="relative">
                  <div
                    className="pointer-events-none absolute -inset-6 -z-10 rounded-3xl opacity-50 blur-2xl"
                    style={{ background: `radial-gradient(closest-side, color-mix(in srgb, ${color} 22%, transparent), transparent)` }}
                  />
                  <CategoryVisual kind={cat.visual} />
                </div>
              </div>
            </div>
          </Section>
        );
      })}

      {/* Cross-links */}
      <Section className="!pt-4">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          <span className="text-[var(--mk-faint)]">Go deeper:</span>
          <Link href="/docs" className="inline-flex items-center gap-1.5 text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            Documentation <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/how-it-works" className="inline-flex items-center gap-1.5 text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            How it works <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/pricing" className="inline-flex items-center gap-1.5 text-[var(--mk-fg)] hover:text-[var(--mk-violet)]">
            Pricing <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Section>

      <Section className="!pt-8">
        <CtaBand />
      </Section>
    </>
  );
}
