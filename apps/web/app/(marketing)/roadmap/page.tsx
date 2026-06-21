import type { Metadata } from "next";
import { Section, SectionHeading } from "@/components/marketing/Section";
import { CtaBand } from "@/components/marketing/CtaBand";

export const metadata: Metadata = {
  title: "Roadmap — Prism",
  description: "What's shipped, what's in progress, and what's next for Prism.",
};

type Column = { title: string; color: string; items: string[] };

const COLUMNS: Column[] = [
  {
    title: "Shipped",
    color: "var(--mk-emerald)",
    items: [
      "Universal gateway — 16+ providers",
      "TypeScript & Python drop-in SDKs",
      "Cost & usage observability",
      "FinOps, chargeback & cost centers",
      "Model efficiency (cache hit, tokens/$)",
      "Unit economics by feature & action",
      "Agents & MCP tool analytics",
      "Session traces & waterfalls",
      "Model governance & approvals",
      "Spend caps & budgets",
      "Training run cost tracking",
      "Customers P&L",
      "Quality, annotations & evals",
      "Cost optimization copilot",
      "Shadow IT detection & reconciliation",
    ],
  },
  {
    title: "In progress",
    color: "var(--mk-gold)",
    items: [
      "Streaming-output guardrails",
      "Azure Content Safety provider",
      "Bedrock guardrail credential wiring",
      "Public status page",
      "Expanded alerting destinations",
    ],
  },
  {
    title: "Planned",
    color: "var(--mk-violet)",
    items: [
      "More cloud billing connectors",
      "Deeper model & quality drift detection",
      "Scheduled report exports",
      "SSO / SCIM provider expansions",
      "Budget forecasting & what-if analysis",
    ],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <Section className="!pb-10 !pt-20">
        <SectionHeading
          eyebrow="Roadmap"
          title={<>Where Prism is <span className="mk-grad-text italic">headed</span></>}
          description="We build in the open. Here's what's live, what's cooking, and what's next. Have a request? Tell us."
        />
      </Section>

      <Section className="!pt-0">
        <div className="grid gap-5 lg:grid-cols-3">
          {COLUMNS.map((col) => (
            <div key={col.title} className="mk-card p-6">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: col.color }} />
                <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--mk-fg)]">
                  {col.title}
                </h2>
                <span className="ml-auto text-xs tabular-nums text-[var(--mk-faint)]">{col.items.length}</span>
              </div>
              <ul className="mt-4 space-y-2.5">
                {col.items.map((it) => (
                  <li
                    key={it}
                    className="rounded-lg border mk-hairline bg-white/[0.02] px-3 py-2.5 text-sm text-[var(--mk-muted)]"
                  >
                    {it}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section className="!pt-0">
        <CtaBand
          title="Want to shape what's next?"
          description="Tell us what would make Prism indispensable for your team — we read every request."
          primary={{ label: "Share a request", href: "/contact" }}
          secondary={{ label: "Start for free", href: "/signup" }}
        />
      </Section>
    </>
  );
}
