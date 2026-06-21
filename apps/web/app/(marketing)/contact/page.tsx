import type { Metadata } from "next";
import { Mail, MessageSquare, CalendarClock } from "lucide-react";
import { Section } from "@/components/marketing/Section";
import { ContactForm } from "@/components/marketing/ContactForm";

export const metadata: Metadata = {
  title: "Contact — Prism",
  description: "Talk to the Prism team — book a demo, ask about pricing, or get help mapping Prism to your stack.",
};

const METHODS = [
  { icon: Mail, title: "Email us", body: "hello@useprism.dev", color: "var(--mk-violet)" },
  { icon: CalendarClock, title: "Book a demo", body: "See Prism on your own data in 30 minutes.", color: "var(--mk-sky)" },
  { icon: MessageSquare, title: "Response time", body: "We reply to most messages within one business day.", color: "var(--mk-emerald)" },
];

export default function ContactPage() {
  return (
    <Section className="!pt-24">
      <div className="grid gap-12 lg:grid-cols-2">
        <div>
          <p className="mk-eyebrow">Contact</p>
          <h1 className="mt-3 font-playfair text-4xl font-semibold tracking-tight text-[var(--mk-fg)]">
            Let&apos;s talk about your <span className="mk-grad-text italic">spend</span>
          </h1>
          <p className="mt-4 max-w-md text-base leading-relaxed text-[var(--mk-muted)]">
            Whether you&apos;re evaluating Prism, sizing a plan, or want a walkthrough on your own
            telemetry — we&apos;re here to help.
          </p>

          <div className="mt-10 space-y-4">
            {METHODS.map((m) => {
              const Icon = m.icon;
              return (
                <div key={m.title} className="flex items-start gap-4">
                  <span
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                    style={{ color: m.color, background: "color-mix(in srgb, currentColor 14%, transparent)" }}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--mk-fg)]">{m.title}</h3>
                    <p className="mt-0.5 text-sm text-[var(--mk-muted)]">{m.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <ContactForm />
      </div>
    </Section>
  );
}
