import { Fragment } from "react";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { PLANS, type Plan, type PlanId } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";

// ── formatters (read from PLANS so the page can never drift from billing) ──────
function fmtEvents(n: number): string {
  if (!isFinite(n)) return "Unlimited";
  if (n >= 1_000_000) return `${n / 1_000_000}M`;
  if (n >= 1_000) return `${n / 1_000}k`;
  return String(n);
}
function fmtMembers(n: number): string {
  return isFinite(n) ? String(n) : "Unlimited";
}
function fmtRetention(d: number): string {
  if (d >= 730) return "2 years";
  if (d >= 365) return "1 year";
  return `${d} days`;
}
function fmtOverage(p: Plan): string {
  if (p.overagePer1k != null) return `$${p.overagePer1k.toFixed(2)} / 1k events`;
  return p.hardCapDefault ? "Hard cap at quota" : "Custom";
}
function fmtPrice(p: Plan): { amount: string; suffix: string } {
  if (p.priceUsd == null) return { amount: "Custom", suffix: "" };
  if (p.priceUsd === 0) return { amount: "$0", suffix: "forever" };
  return { amount: `$${p.priceUsd}`, suffix: "/month" };
}

const ORDER: PlanId[] = ["free", "pro", "team", "enterprise"];
const POPULAR: PlanId = "pro";

const TAGLINES: Record<PlanId, string> = {
  free: "For solo builders getting started.",
  pro: "For teams shipping LLM features.",
  team: "For organizations running at scale.",
  enterprise: "For regulated, high-volume deployments.",
};

const HIGHLIGHTS: Record<PlanId, { lead?: string; items: string[] }> = {
  free: {
    items: [
      "Core observability & raw logs",
      "Projects & cost attribution",
      "Universal gateway + enforcement",
    ],
  },
  pro: {
    lead: "Everything in Free, plus",
    items: [
      "FinOps, chargeback & unit economics",
      "Sessions, agents & MCP analytics",
      "Model governance & compliance hub",
      "Arena, evals & cost optimization engine",
    ],
  },
  team: {
    lead: "Everything in Pro, plus",
    items: [
      "Higher quotas & lower overage rates",
      "Up to 50 members",
      "1-year data retention",
      "Priority support",
    ],
  },
  enterprise: {
    lead: "Everything in Team, plus",
    items: [
      "SSO / SAML & SCIM provisioning",
      "Dedicated environment & SLA",
      "Custom retention & residency",
      "White-glove onboarding",
    ],
  },
};

const CTA: Record<PlanId, { label: string; href: string }> = {
  free: { label: "Start for free", href: "/signup" },
  pro: { label: "Start 14-day trial", href: "/signup" },
  team: { label: "Start 14-day trial", href: "/signup" },
  enterprise: { label: "Contact sales", href: "/contact" },
};

function PlanCard({ plan }: { plan: Plan }) {
  const popular = plan.id === POPULAR;
  const price = fmtPrice(plan);
  const hl = HIGHLIGHTS[plan.id];
  const cta = CTA[plan.id];

  return (
    <div
      className={cn(
        "mk-card relative flex flex-col p-6",
        popular && "ring-1 ring-[#a78bfa]/60"
      )}
    >
      {popular && (
        <span className="mk-btn-primary absolute -top-3 left-6 rounded-full px-3 py-0.5 text-[11px] font-semibold">
          Most popular
        </span>
      )}

      <h3 className="text-lg font-semibold text-[var(--mk-fg)]">{plan.name}</h3>
      <p className="mt-1 text-sm text-[var(--mk-muted)]">{TAGLINES[plan.id]}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="font-playfair text-4xl font-semibold text-[var(--mk-fg)]">{price.amount}</span>
        {price.suffix && <span className="text-sm text-[var(--mk-faint)]">{price.suffix}</span>}
      </div>

      <dl className="mt-5 space-y-2 border-y py-4 mk-hairline text-sm">
        <div className="flex justify-between">
          <dt className="text-[var(--mk-faint)]">Events / month</dt>
          <dd className="font-medium tabular-nums text-[var(--mk-fg)]">{fmtEvents(plan.eventsIncluded)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--mk-faint)]">Members</dt>
          <dd className="font-medium tabular-nums text-[var(--mk-fg)]">{fmtMembers(plan.memberLimit)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--mk-faint)]">Retention</dt>
          <dd className="font-medium text-[var(--mk-fg)]">{fmtRetention(plan.retentionDays)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-[var(--mk-faint)]">Overage</dt>
          <dd className="font-medium text-[var(--mk-fg)]">{fmtOverage(plan)}</dd>
        </div>
      </dl>

      <div className="mt-4 flex-1">
        {hl.lead && <p className="mb-2 text-xs font-medium text-[var(--mk-muted)]">{hl.lead}</p>}
        <ul className="space-y-2">
          {hl.items.map((it) => (
            <li key={it} className="flex gap-2 text-sm text-[var(--mk-muted)]">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-[var(--mk-violet)]" />
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        href={cta.href}
        className={cn(
          "mt-6 inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold",
          popular ? "mk-btn-primary" : "mk-btn-ghost"
        )}
      >
        {cta.label}
      </Link>
    </div>
  );
}

export function PricingCards() {
  return (
    <div className="grid gap-5 lg:grid-cols-4">
      {ORDER.map((id) => (
        <PlanCard key={id} plan={PLANS[id]} />
      ))}
    </div>
  );
}

// ── Full comparison matrix (grounded in platform_features min_plan seed) ──────
type Cell = boolean | string;
interface MatrixRow { label: string; values: [Cell, Cell, Cell, Cell] }

const MATRIX: { group: string; rows: MatrixRow[] }[] = [
  {
    group: "Usage & limits",
    rows: [
      { label: "Telemetry events / month", values: ["100k", "2M", "10M", "Unlimited"] },
      { label: "Team members", values: ["2", "10", "50", "Unlimited"] },
      { label: "Data retention", values: ["7 days", "90 days", "1 year", "2 years+"] },
      { label: "Overage billing", values: ["Hard cap", "$0.50 / 1k", "$0.30 / 1k", "Custom"] },
    ],
  },
  {
    group: "Observability",
    rows: [
      { label: "Cost & usage dashboards", values: [true, true, true, true] },
      { label: "Raw event logs", values: [true, true, true, true] },
      { label: "Per-model efficiency", values: [true, true, true, true] },
      { label: "Sessions & agent / MCP analytics", values: [false, true, true, true] },
    ],
  },
  {
    group: "FinOps & economics",
    rows: [
      { label: "Projects & cost attribution", values: [true, true, true, true] },
      { label: "FinOps, vendor spend & chargeback", values: [false, true, true, true] },
      { label: "Unit economics (cost per feature/action)", values: [false, true, true, true] },
      { label: "Training run cost tracking", values: [false, true, true, true] },
      { label: "Billing vault (AWS / Pinecone / Qdrant)", values: [false, true, true, true] },
    ],
  },
  {
    group: "Governance & security",
    rows: [
      { label: "Gateway & enforcement coverage", values: [true, true, true, true] },
      { label: "Model governance (allow / block / approve)", values: [false, true, true, true] },
      { label: "Compliance hub (audit, PII, residency)", values: [false, true, true, true] },
      { label: "SSO / SAML & SCIM", values: [false, false, false, true] },
    ],
  },
  {
    group: "Developer & support",
    rows: [
      { label: "Model Arena & evaluations", values: [false, true, true, true] },
      { label: "Cost optimization engine", values: [false, true, true, true] },
      { label: "Team management & roles", values: [false, true, true, true] },
      { label: "Support", values: ["Community", "Email", "Priority", "Dedicated"] },
    ],
  },
];

function MatrixCell({ value }: { value: Cell }) {
  if (value === true) return <Check className="mx-auto h-4 w-4 text-[var(--mk-emerald)]" />;
  if (value === false) return <Minus className="mx-auto h-4 w-4 text-[var(--mk-faint)]" />;
  return <span className="tabular-nums text-[var(--mk-fg)]">{value}</span>;
}

export function PricingMatrix() {
  return (
    <div className="mk-card overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b mk-hairline">
            <th className="px-5 py-4 text-left font-medium text-[var(--mk-muted)]">Compare plans</th>
            {ORDER.map((id) => (
              <th key={id} className="px-5 py-4 text-center font-semibold text-[var(--mk-fg)]">
                {PLANS[id].name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX.map((section) => (
            <Fragment key={section.group}>
              <tr>
                <td
                  colSpan={5}
                  className="bg-white/[0.02] px-5 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--mk-faint)]"
                >
                  {section.group}
                </td>
              </tr>
              {section.rows.map((row) => (
                <tr key={row.label} className="border-b mk-hairline last:border-0">
                  <td className="px-5 py-3 text-[var(--mk-muted)]">{row.label}</td>
                  {row.values.map((v, i) => (
                    <td key={i} className="px-5 py-3 text-center">
                      <MatrixCell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
