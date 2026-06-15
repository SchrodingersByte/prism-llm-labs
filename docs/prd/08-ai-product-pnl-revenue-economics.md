# PRD-08 — AI Product P&L & Revenue Economics (Sales / RevOps wedge)

> **Track:** Revenue economics (a **separate thread** from the Quality & Intelligence suite) ·
> **Status:** Draft for review · **Depends on:** existing customer cost attribution (independent of
> PRD-0–7; can ship in parallel) · **Integrates with:** PRD-7 (Copilot margin Q&A) ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap → Adjacent thread](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism can already compute **cost-to-serve per customer** but has **no revenue and therefore no
margin**. Sales/RevOps and Finance can't see gross margin per customer or plan — so they can't price
confidently, protect margins as usage grows, or spot upsell/at-risk accounts. This is the single
biggest piece of the "remaining ~15%" and a commercial differentiator: **the cost half is fully built;
this PRD adds the revenue half and the margin layer on top.** It turns Prism from a cost tool into an
**AI Product P&L** — the story no observability competitor (cost-only) and no billing platform
(revenue-only) can tell.

## 2. Current state (code anchors)
- **Customer registry:** `customer_quota_profiles` (`supabase/migrations/20260612150000_finance_billing.sql:131`)
  — `customer_id`, `display_name`, `monthly_spend_usd` (**a cap, not revenue**), `monthly_token_limit`,
  **`soft_cap_model`** (a ready-made margin-guardrail lever), `is_active`. RLS: member read / admin
  write. CRUD: `app/api/customers/route.ts` (`isOrgManager` for writes).
- **Cost-to-serve already computable:** `tinybird/pipes/spend_by_customer.pipe`,
  `customer_timeseries_daily.pipe`, `customer_model_breakdown.pipe`; `/api/v1/customers/[customerId]/
  usage`; `/api/metrics/customers/[customerId]/{daily,models}`. Cost is attributed via a `customer_id`
  tag on `llm_events`.
- **Other cost inputs:** `mcp_cost_reconciliation` + `infra_cost_breakdown` (MCP/vector-DB/infra),
  `training_runs` (training). **Value signal:** `outcome_events.value_usd` / `cost_per_outcome`.
- **Sync scaffolding:** `cloud_billing_connections` + `lib/billing/sync.ts` (per-provider dispatcher:
  Pinecone/Qdrant/AWS/OpenAI-training) — the pattern to extend for **revenue** providers.
- **Ingest template:** `app/api/outcomes/route.ts` (key-authed, dual-write) + SDK
  `EventTracker.recordOutcome()` — the template for revenue ingestion.
- **Absent:** any revenue-per-customer capture, margin computation, or margin dashboards/guardrails.

## 3. Competitive context
Amberflo ties usage→cost→billing with **margin visibility per customer**; Pay-i emphasizes product
**unit economics**; Vantage/CloudZero are **cost-only** (no revenue/margin); Metronome/Orb meter
**revenue** but don't know your LLM cost-to-serve. Nobody fuses **cost + revenue + (via PRD-1) quality**
per AI customer — Prism's spine can.
*Sources: [Amberflo margin/metering](https://amberflo.io/blog/top-6-metronome-billing-alternatives-in-2026), [FinOps for AI (Vantage)](https://www.vantage.sh/blog/best-finops-tools-for-ai), [usage-based billing landscape](https://dodopayments.com/blogs/best-billing-platform-usage-based-pricing).*

## 4. Goals / Non-goals
**Goals:** capture revenue per customer (sync + API + manual + modeled); compute **gross margin =
revenue − cost-to-serve** per customer/plan/period; margin dashboards (cost-to-serve, margin %,
unprofitable flags, trend); **margin guardrails** (alert + optional `soft_cap_model` downgrade);
billing-platform sync (Stripe/Metronome/Orb). **Non-goals:** becoming a billing system (we **read**
revenue, never invoice or charge); the quality suite (separate); general product analytics.

## 5. Division value
- **Sales / RevOps** — gross margin per account, upsell/at-risk signals, margin-aware pricing.
- **Finance** — AI COGS, cost-to-serve, gross margin as a first-class metric.
- **Product** — which features/customers erode margin.
- **Exec** — a real AI P&L; "are we making money per customer?"

## 6. Functional requirements
- **Revenue ingestion**, four sources (see §6a for fidelity + definitions): (a) billing-platform
  **sync** (Stripe/Metronome/Orb → *actual* revenue per `customer_id`), (b) `POST /api/revenue`
  (key-authed, like outcomes), (c) manual/CSV in the UI, (d) **modeled** = metered usage × a rate card
  (the only source Prism can produce with zero integration).
- **Cost-to-serve rollup** per customer/period: LLM (`spend_by_customer`) + MCP/infra
  (`mcp_cost_reconciliation`/`infra_cost_breakdown`) + a training allocation.
- **Margin computation**: `revenue − cost_to_serve`, `margin_pct`, per customer & plan, per period.
- **Margin guardrails**: negative/low-margin alert (reuse alerts) + optional auto-downgrade via the
  existing `soft_cap_model`.
- **Multi-currency** normalization to a reporting currency.

### 6a. Revenue definition & quantification
Revenue is the money **your org's customer pays your org** (the entity behind the `customer_id` tag) —
**not** what the org pays Prism. Cost is derived from telemetry; **revenue has no telemetry signal**, so
it must be sourced. The four mechanisms, by fidelity:

| # | Mechanism | Gives | Fidelity |
|---|---|---|---|
| A | Billing-platform sync (Stripe/Metronome/Orb) | Actual invoiced/recognized revenue per customer | Highest |
| B | `recordRevenue()` API/SDK push | Org-computed revenue | High |
| C | Manual / CSV upload | Finance-entered table | Medium |
| D | Modeled = metered usage × rate card | *Expected* revenue (estimate) | Estimate |

A–C are **actuals**; **D** is the only one Prism generates from its own data (reuses the per-customer
metering behind `customer_quota_profiles`) — it bootstraps margin before any integration and flags
**expected-vs-actual drift** (under-billing). The margin layer **prefers actuals, falls back to
modeled**, and every figure carries its `source`.

**Definitional defaults (configurable per org):**
- **Revenue basis:** *recognized* revenue (not invoiced/collected), **monthly** period, **net** of
  refunds/credits.
- **Pricing-model handling:** flat-subscription / seat-based → synced or entered (A/B/C); usage-based
  reseller → modeled (D); hybrid → subscription (A) + usage overage (D).
- **Identity mapping:** billing-platform customer ID ↔ Prism `customer_id`, reconciled via a mapping
  table + a UI for unmatched records (the main operational gotcha).
- **Currency:** normalize to the org's reporting currency at ingest (store original + normalized).

## 7. Data model
- **Supabase `customer_revenue`**: `id, org_id, customer_id, period (month), amount_usd (normalized),
  amount_original, currency, source (sync|api|manual|modeled), external_ref, created_at` — RLS
  member-read / admin-write (mirror `customer_quota_profiles`).
- **Supabase `customer_rate_cards`** (powers source D): `org_id, customer_id|plan, unit
  (token|action|seat|request), unit_price_usd, effective_from` → modeled revenue = metered usage × rate.
- **Supabase `customer_revenue_map`**: `org_id, provider, external_customer_id, customer_id` — the
  billing-ID ↔ `customer_id`-tag reconciliation.
- **Tinybird `customer_pnl` pipe**: join `spend_by_customer` (cost) + `customer_revenue` (revenue) +
  `infra_cost_breakdown`/`mcp_cost_reconciliation` (infra) → `{customer_id, period, revenue,
  revenue_source, cost_to_serve, gross_margin, margin_pct}`. Optional `revenue_events` Tinybird DS
  mirror (like `outcome_events`).
- **Reuse `cloud_billing_connections`** for sync credentials — add provider types `stripe`,
  `metronome`, `orb`.

## 8. API & SDK surface (TS + Python parity)
- `POST /api/revenue` (key-authed, single/batch, dual-write) — modeled on `/api/outcomes`.
- `GET /api/customers/[id]/pnl` — margin + cost-to-serve breakdown for a customer/period.
- `GET /api/metrics/pnl` — org-wide P&L table (by customer/plan).
- **Billing sync**: extend `lib/billing/sync.ts` with revenue providers (Stripe/Metronome/Orb) writing
  `customer_revenue`.
- **SDK**: `prism.recordRevenue({ customerId, amountUsd, period?, currency? })` (mirror
  `recordOutcome()`), TS + Python.

## 9. UX / dashboard pages
- **Extend `/dashboard/customers`**: add columns — revenue, cost-to-serve, **gross margin**, margin %;
  unprofitable-customer flag; sort by margin.
- **P&L view**: margin by customer & plan + trend; at-risk / upsell list.
- **Settings → Integrations**: billing-platform connector (reuse the billing-APIs page pattern).
- **Copilot hook (PRD-7)**: "which customers are unprofitable?" answers from `customer_pnl`.

## 10. Phased task breakdown + acceptance criteria
- **P8.1** Actuals ingest: `customer_revenue` table + `POST /api/revenue` + SDK `recordRevenue` + manual/CSV. *AC:* revenue lands per customer; `read_only` blocked on manual entry.
- **P8.2** Modeled revenue (source D): `customer_rate_cards` + modeled computation from metered usage. *AC:* a usage-based customer gets *expected* revenue with zero integration, labeled `source=modeled`.
- **P8.3** Cost-to-serve rollup + `customer_pnl` pipe (prefers actuals, falls back to modeled). *AC:* margin = revenue − cost per customer/period, carrying `revenue_source`.
- **P8.4** P&L dashboard (customers columns + P&L view). *AC:* margin %, unprofitable flags render.
- **P8.5** Margin guardrails (alert + optional `soft_cap_model`). *AC:* a negative-margin customer fires an alert.
- **P8.6** Billing-platform sync (Stripe first) + identity-mapping UI. *AC:* Stripe revenue maps to `customer_id`; unmatched records surfaced for resolution.

## 11. Dependencies
Builds on existing customer **cost** attribution (independent of PRD-0–7 → can ship in parallel).
Integrates with **PRD-7** (Copilot margin Q&A) and **`outcome_events`** (value/ROI). Reuses
`cloud_billing_connections`, `lib/billing/sync.ts`, `/api/outcomes` pattern, and `soft_cap_model`.

## 12. Success metrics / KPIs
% of customers with revenue mapped; gross-margin visibility (org-wide + per customer); negative-margin
accounts flagged; margin-guardrail saves; time-to-answer "are we profitable per customer?"

## 13. Risks & open questions
- **Revenue↔customer mapping** (billing customer ID ↔ `customer_id` tag) → mapping table + a clear
  reconciliation UI.
- **Multi-currency** → normalize to a reporting currency (FX source TBD).
- **Shared-cost allocation fairness** (infra serving many customers) → proportional allocation
  (reuse the Qdrant/AWS allocation approach in `lib/billing/`).
- **Scope discipline** — read revenue only; never invoice/charge (avoid becoming a billing system).
- **Modeled vs actual** — never present modeled (source D) revenue as actuals; surface `source` on
  every figure and prefer actuals in the margin calc.
- **Open:** first billing connector — *recommend Stripe* (most common), then Metronome/Orb.

## 14. Out of scope (code-analysis doc to follow)
Exact migration SQL, the `customer_pnl` pipe SQL, billing-connector auth, FX handling, and tests —
covered in the PRD-08 code-analysis doc after approval (slots into the critical path after PRD-7, or
parallel since it's an independent thread).
