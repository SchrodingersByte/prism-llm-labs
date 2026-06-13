# Phase B / C / D — Billing, Governance, Reconciliation

**Status:** backend implemented (this pass); **frontend is design-only** in this doc.
**Branch:** `feat/org-rbac-phase-a`. **Predecessor:** Phase A (Owner/Admin/Developer RBAC,
multi-org, Developer project-scoping) — see memory `project_org_billing_rbac`.

Billing model (locked 2026-06-12): **metered on ingested telemetry events**, not per
seat. Member count is a **per-tier cap**, not a per-head charge.

---

## Plan tiers (single source of truth)

Defined in [`apps/web/lib/billing/plans.ts`](../apps/web/lib/billing/plans.ts) and mirrored
by the `organizations.plan` CHECK + `platform_features.min_plan`
(migration `20260620000000_phase_b_billing_budgets.sql`).

| Tier | rank | Price/mo | Members | Events incl./mo | Retention | Hard-cap default |
|---|---|---|---|---|---|---|
| **Free** | 1 | $0 | 2 | 100k | 7d | yes (block at quota) |
| **Pro** | 2 | $49 | 10 | 2M | 90d | no (billed overage) |
| **Team** | 3 | $199 | 50 | 10M | 365d | no |
| **Enterprise** | 4 | custom | ∞ | ∞ | 730d | no |

Legacy values (`developer/startup/enterprise`, plus `solo/starter/growth/scale`) were
migrated: developer→free, startup→pro, scale→enterprise.

---

## Phase B — Billing & Metering

### Implemented (backend)
- **Tier consolidation** + the missing billing columns that the app already wrote but the
  schema lacked: `organizations.subscription_status` (`trialing|active|past_due|canceled`),
  `stripe_customer_id`, `stripe_subscription_id`. This un-breaks `/api/billing/upgrade`
  (it was 500-ing on a missing column).
- **Member caps by tier** — [`team/invite`](../apps/web/app/api/team/invite/route.ts) now
  enforces `memberLimitFor(plan)` (was a dead `seat_count` read that silently capped at 1).
- **Usage metering** — [`lib/billing/usage.ts`](../apps/web/lib/billing/usage.ts):
  `getMonthlyEventCount` (LLM + MCP events from Tinybird) and `getUsageSummary`
  (used vs included, overage, %).
- **Region-based payment providers** — the owner picks a region
  (`organizations.billing_region`: `US`→Stripe, `IN`→Razorpay) via `/api/billing/region`.
  The unified **`/api/billing/checkout`** reads the region and dispatches: Stripe → hosted
  checkout URL; Razorpay → subscription id + key for client-side Checkout. Confirmation/
  lifecycle via **`/api/billing/stripe/webhook`** and
  **`/api/billing/razorpay/{verify,webhook}`** (each the source of truth for its region).
  `lib/billing/provider.ts` maps region→provider; `lib/billing/razorpay.ts` mirrors `stripe.ts`.
- **Subscription flow** — `/api/billing/upgrade` (manual/sales-led flip, owner-only) and
  `/api/billing/downgrade` (→ free) remain for no-payment plan changes.
- **Status API** — `/api/billing/status` returns plan + subscription + members + usage.

### Open items
- **Provider env config** (both SDKs installed: `stripe`, `razorpay`). Unconfigured
  providers return 503.
  - Stripe → `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_TEAM`.
  - Razorpay → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
    `RAZORPAY_PLAN_PRO`, `RAZORPAY_PLAN_TEAM` (env currently only has the legacy
    `RAZORPAY_PLAN_STARTER/GROWTH/SCALE`).
  - Legacy `/api/billing/subscribe` + `/api/billing/verify` are 410 stubs.
- **Spend-cap toggle** (Supabase-style): hard-cap vs allow-overage at the *billing* layer is
  modeled by `Plan.hardCapDefault`; the enforcement hook (throttle ingestion past quota) is
  not yet wired into `/api/*/ingest`. Keep this **separate** from `key_caps` /
  `customer_quota_profiles`, which cap the customer's own LLM spend.

### Frontend design — Billing page (`/dashboard/settings/billing`)
- **Region selector** (United States / India) → POST `/api/billing/region`; sets whether
  checkout uses Stripe (USD) or Razorpay (INR). Show the active provider from
  `/api/billing/status` → `billing.provider`.
- **Plan card row** (4 cards, current plan highlighted) driven by `PLANS`. CTA per card:
  current → "Manage"; lower → "Downgrade"; higher → "Upgrade" → POST `/api/billing/checkout`,
  then by `provider`: Stripe → redirect to `url`; Razorpay → open Razorpay Checkout with
  `{ subscriptionId, keyId }`, then POST the callback to `/api/billing/razorpay/verify`.
- **Usage panel**: events used / included with a progress bar (amber ≥80%, red ≥100%),
  overage estimate, retention window. Source: `/api/billing/status`.
- **Members panel**: `used / limit`, with an inline "Upgrade to add more" when at cap.
- **Invoices**: list from Stripe (when configured); empty state otherwise.
- Owner-only actions; Admins see read-only; Developers don't see the page.

---

## Phase C — Governance & Budgets

### Implemented (backend)
- **Budget hierarchy + provider dimension** — `budgets` gains `enforce_hard_cap`, `user_id`,
  `provider`; `projects.monthly_budget_usd` added (the gateway's
  [`budget.ts`](../apps/web/lib/gateway/budget.ts) read all of these but they didn't exist —
  hard-cap enforcement was dead). A partial-unique index enforces one budget per
  (org, project, user, provider, period) scope.
- **Resolution precedence** (`resolveOrgBudget`): provider-scoped → project → org-wide.
  `getGatewaySoftCapStatus` takes an optional `provider`.
- **Budget API** — [`/api/budgets`](../apps/web/app/api/budgets/route.ts) rewritten: fixed
  the broken insert (`alert_pct`→`alert_threshold_pct`, dropped non-existent `team_id`),
  added `provider`, added **hierarchy validation** (project budget ≤ org budget), tightened
  gating (only owner/admin set org/project/provider/other-user budgets; a developer may set
  only their own).

### Open items
- ✅ **Gateway provider hard-caps wired** — the gateway route passes the upstream `provider`
  into `getGatewaySoftCapStatus`, so provider-scoped budgets now enforce.

### Frontend design — Govern studio (`/dashboard/govern`) + Budgets
The six org policies (all have backing tables already):
1. **PII control** (detect/mask/block) — org PII columns
2. **Model governance** (allow/block/requires-approval) — `org_model_policies` + `model_approval_requests`
3. **Enforcement / Shadow IT** — `sdk_bypass_events`, `enforce_checkins`
4. **Data residency** — `organizations.data_residency_policy`
5. **Guardrails** (input/output) — `guardrail_profiles` / `guardrail_rules`
6. **Gateway-only mode** — `organizations.gateway_mode`

- **Layout**: left rail of the six policies, right pane is the editor for the selected one.
  Each policy shows status (off / warn / enforce) + scope (org / per-project override).
- **Budgets tab**: a tree — Org budget at the root, Project budgets nested (with a guard that
  visually caps the slider at the org amount), and Provider budgets as a flat list. Show
  current spend vs limit (from `/api/metrics/budget-status` + gateway spend). Owner/Admin edit;
  Developers read their project's budget only.

---

## Phase D — Reconciliation & Project views

### Backend (mostly pre-existing)
- `mcp_cost_reconciliation` (estimated vs actual, `resource_name`/`operation_type`/`environment`),
  `cloud_billing_connections`, `lib/billing/sync.ts`, and `/api/metrics/reconciliation`
  (now owner/admin-gated) already provide the data. No new backend required for D1.
- Project observability (`sdk_bypass_events`, branch tree, per-project keys) is served by
  existing routes; D2 is primarily a UI assembly.

### Frontend design — Reconciliation dashboard
- **Estimated vs Actual** pivot with a **variance %** column, along two axes: by **provider**
  (LLM: OpenAI/Anthropic/Bedrock; infra: Pinecone/Qdrant/AWS) and drill-down by **resource**
  (per-index/collection). Per-row "last synced" badge. "Sync now" → `/api/billing/sync`.
- Color variance: green ≤5%, amber ≤20%, red >20%.

### Frontend design — Project pages (`/dashboard/projects/[id]`)
- Tabs: **Overview** (scoped metrics) · **Traces/Intelligence** · **Routing** · **Enforce**
  (bypass view from `sdk_bypass_events`) · **GitHub** (branch tree, analytics + gateway) ·
  **Keys** (Prism keys; Developers can create within their assigned project) · **Budget**
  (owner/admin; ≤ org global).
- Respect Phase A scoping: Developers only see projects they're assigned to.

---

## Cross-cutting follow-ups
- ✅ **`database.types.ts` regenerated** from the live schema (includes all new columns).
- ✅ **A3 dev-observability resolved** — anomalies, efficiency, session-distribution, and
  mcp overview/servers/tools are project-scoped for Developers (via `project_ids`); mcp/loops
  + stream are `isOrgManager`-gated (those pipes have no project dimension).
- **Onboarding** still offers `developer|startup` plan ids — update to `free|pro|team|enterprise`
  (frontend — see Billing page design).
- **Spend-cap toggle enforcement** (throttle ingestion past the event quota) is still unwired
  — see Phase B open items.
