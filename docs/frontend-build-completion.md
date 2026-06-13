# Frontend Build — Completion Tracker

Living status of the Prism frontend rebuild (two-tier org→project, role-aware,
Supabase-dark). Updated after **every** task. Legend: ✅ done · 🔨 in progress · ⬜ pending.

Cross-refs: roadmap `~/.claude/plans/jiggly-twirling-scroll.md`; RBAC/flow
`~/.claude/plans/iterative-puzzling-bonbon.md`; backend design `docs/billing-rbac-phase-bcd.md`;
page specs `docs/reconciliation-dashboard.md`, `docs/pii-control-page.md`.

---

## Foundation & shell — ✅ done (prior passes)
- ✅ Phase 0 — design system, 21 shadcn primitives, providers (react-query/nuqs/theme/sonner),
  URL scope state, typed API client, component gallery (`/dashboard/dev/gallery`).
- ✅ Phase 1 — two-tier shell (org/project sidebars + secondary nav), Supabase-dark reskin
  (neutral surfaces, indigo accent), routing scaffold.
- ✅ Phase 2 — `environment` + `project_id`/`project_ids` params in ~15 Tinybird pipes;
  threaded through `queries.ts` + metric routes. *(deploy pending: `tb --cloud deploy`)*
- ✅ Role-aware shell — role-filtered nav (`lib/nav.ts` `roles`+`canSee`), `RoleProvider`,
  `/api/projects` developer clamp, project-detail developer 404, role-aware Projects grid.
- ✅ A5 — ownership transfer RPC + owner-only route.
- ✅ A0 — verified `teams`/`accounts` are load-bearing; drop declined.

## Widget engine + Overviews (Phase 3) — 🔨 in progress
- ✅ W1 — metric fetchers (projectId-aware) + `useWidgetData` hook + widget registry
  (`components/widgets/registry.tsx`: 4 KPI + spend-trend + top-models + spend-by-project).
- ✅ W2 — `DashboardCanvas` 12-col grid renderer (`components/widgets/DashboardCanvas.tsx`).
- ✅ W3 — org Overview wired (`app/dashboard/page.tsx`) + developer "no projects assigned" empty-state.
- ✅ W4 — project Overview wired (`app/dashboard/projects/[id]/page.tsx`, scoped to route project).
- ⬜ W5 — `dashboard_views` migration + persistence + customize mode + Add-widget catalog. *(needs migration)*

## Billing page `/dashboard/billing` (owner action / admin read-only) — ✅ done  [backend Phase B]
- ✅ Region selector (US→Stripe / IN→Razorpay) → `/api/billing/region`.
- ✅ Plan cards (Free/Pro/Team/Enterprise), current highlighted; owner upgrade→`/api/billing/checkout`
  (Stripe redirect / Razorpay), downgrade→free, enterprise→sales. Admin read-only; dev nav-hidden.
- ✅ Usage panel (events used/included + bar @80/100%, overage, retention), members panel (used/limit + at-cap), invoices empty.
- Nav: Billing now visible to owner+admin (actions owner-gated). Checkout return path → `/dashboard/billing`.

## Govern studio `/dashboard/govern` — ⬜ pending  [design: Phase C]
- ⬜ Six-policy rail + editor (PII, model gov, enforcement/Shadow IT, residency, guardrails, gateway mode).
- ⬜ Budgets tab (org→project→provider tree; ≤ org guard).

## Reconciliation dashboard — ⏸ parked  [design: docs/reconciliation-dashboard.md]
- Blocked by design ("do not build yet"): no data (no `cloud_billing_connections`, empty
  `actual_billing_records`), depends on migration `20260617` (`resource_name`). Build empty-state-first
  once a billing source is connected.

## Project sub-pages `/dashboard/projects/[id]/*` — ⬜ pending
- ⬜ Observability (logs/sessions/traces/agents), Spend, API Keys (+caps/requests),
  Enforcement (bypass view), Governance, Settings (budget ≤ org, GitHub, cost center).

## Org tier pages — ⬜ pending
- ⬜ Integrations (provider keys, billing APIs, GitHub, Slack, exports), Teams (members/roles/invite), Settings.
- ⬜ PII control page  [design: docs/pii-control-page.md].

## Pending infra (user-applied)
- ⬜ `tb --cloud deploy` (pipe env + project_ids isolation filters).
- ⬜ Apply migrations `20260619`, `20260620` (×2 — see note), `20260621`.
- ⚠️ **Migration timestamp collision**: two files named `20260620000000_*`
  (`transfer_ownership_fn`, `phase_b_billing_budgets`) — rename one to a later timestamp
  to guarantee deterministic ordering.
