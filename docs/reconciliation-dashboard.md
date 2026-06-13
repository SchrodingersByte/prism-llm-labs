# Design Recommendation — Cost Reconciliation Dashboard

> Status: **design only — do not build yet.** Page lives at
> `apps/web/app/dashboard/settings/reconciliation/page.tsx` (currently `export default function Page() { return null; }`)
> and is mounted in the **Settings → Compliance** tab shell (`/settings/compliance`, alongside Audit Log).
> AREA 4 / T4.4. Author: this is a recommendation; numbers below are illustrative.

## 1. Purpose

Answer one CFO-grade question: **"How close are our _estimated_ AI-infra costs to the _actual_ vendor bills, and where do they diverge?"**

Prism records an **estimate** at call time (per-token LLM cost, per-call MCP tool cost). Separately, the
vendor-billing sync (`lib/billing/sync.ts`, daily cron `/api/billing/sync`) pulls **actuals** from AWS Cost
Explorer / Pinecone / Qdrant / Weaviate / Azure / GCP / Milvus into `mcp_cost_reconciliation`. This page makes
the **variance** between the two visible, per vendor resource.

## 2. Pre-requisites / current reality (read before building)

- **No data exists yet.** `actual_billing_records` (Tinybird) is empty and there are no (known) active
  `cloud_billing_connections`. **The empty state is the _primary_ state to design — not an afterthought.**
- **Schema fix shipped separately:** migration `20260617000000_reconciliation_columns.sql` adds
  `resource_name / operation_type / environment` to `mcp_cost_reconciliation` (the code wrote them; the table
  lacked them). The page depends on `resource_name` existing. **Must be applied before the page returns data.**
- **Silent-failure caveat:** `sync.ts` does not check `upsert().error`, so a write that fails still reports
  `last_sync_status = "ok"`. The page should surface `cloud_billing_connections.last_sync_status` prominently
  so a broken sync is visible rather than masked. (Hardening `sync.ts` to record real errors is a follow-up.)

## 3. Data model — the estimated-vs-actual join (the crux)

`mcp_cost_reconciliation.estimated_cost` is **0** for vendor-sync rows (the vendor API doesn't know the
per-event estimate). So **variance must join actuals to a _separately-sourced_ estimate by resource:**

| Quantity | Source | Key |
|---|---|---|
| **Actual** cost per resource | Supabase `mcp_cost_reconciliation` → `SUM(actual_cost) GROUP BY resource_name` | `resource_name` e.g. `pinecone:support-docs` |
| **Estimated** cost per resource | Tinybird pipe `vector_db_cost_breakdown` → `estimated_cost_usd` per `resource` | `resource` = `downstream_resource`, same `"pinecone:support-docs"` format |
| **Unified infra totals** | Tinybird pipe `infra_cost_breakdown` → `category, cost_usd` (llm_inference / `<resource>` / model_training) | `category` |
| **Per-event reconcile** (manual) | `mcp_cost_reconciliation` rows written by `POST /api/mcp/reconcile` (has both `estimated_cost` and `actual_cost`) | `event_id` |
| **Connection health** | Supabase `cloud_billing_connections` (`provider, last_synced_at, last_sync_status, last_sync_cost_usd, is_active`) | `id` |

The `resource_name` ↔ `resource` formats **already match** (both `vendor:name`), so the join is direct.

`variance$ = actual − estimated` · `variance% = (actual − estimated) / estimated` (guard divide-by-zero).

## 4. Page layout

```
┌─ PageHeader ─────────────────────────────────────────────────────────────┐
│  Cost Reconciliation          [ Date range ▾ ]  [ Sync now ]              │
│  Estimated vs. actual vendor spend across your AI infrastructure.         │
└───────────────────────────────────────────────────────────────────────────┘

┌ KpiCard (indigo) ┐ ┌ KpiCard (cyan) ┐ ┌ KpiCard (amber/emerald) ┐ ┌ KpiCard ┐
│ Estimated (30d)  │ │ Actual (30d)   │ │ Variance                │ │ Coverage│
│ $1,240.18        │ │ $1,602.44      │ │ +$362.26  (+29.2%) ▲    │ │ 78%     │
└──────────────────┘ └────────────────┘ └─────────────────────────┘ └─────────┘
        (variance card: emerald when actual≤estimated, amber/red when over)

┌─ Variance by resource (table) ───────────────────────────────────────────┐
│ Resource              Vendor    Estimated   Actual     Δ$        Δ%        │
│ pinecone:support-docs pinecone  $420.00     $511.30   +$91.30   +21.7% ▲   │
│ qdrant:faq            qdrant    $180.00     $176.10    -$3.90    -2.2% ▼    │
│ aws (Lambda+Dynamo)   aws       $640.18     $915.04  +$274.86   +42.9% ▲   │
└───────────────────────────────────────────────────────────────────────────┘

┌─ Infra cost mix (donut, infra_cost_breakdown) ─┐  ┌─ Connection health ────┐
│  LLM inference  62%                            │  │ pinecone  ✓ 2h ago $511 │
│  Vector DB      27%                            │  │ aws       ⚠ error: ... │
│  Training       11%                            │  │ qdrant    ✓ 2h ago $176 │
└────────────────────────────────────────────────┘  └────────────────────────┘
```

**Components** (per CLAUDE.md UI conventions, do not hand-roll):
- `components/shared/PageHeader.tsx` — `title`, `description`, `actions` (date-range + "Sync now" → `POST /api/billing/sync`).
- `components/dashboard/KpiCard.tsx` — `color` prop: `indigo`=estimated, `cyan`=actual, `emerald`/`red`=variance (green under budget, red over), `amber`=coverage.
- Variance table: a plain `components/ui/table`; right-align money; color Δ cells (emerald/rose). Sort by |Δ$| desc.
- Infra mix: **Recharts** donut, vibrant 8-color palette (not monochrome).
- Connection health: compact list with status pills (emerald `ok`, rose `error: …`, slate never-synced) + relative `last_synced_at`.

## 5. Empty state (the default today)

When there are no `cloud_billing_connections` **or** zero reconciliation rows, render a centered empty card
**instead of** zeroed KPIs/tables:

> **No vendor bills connected yet.** Prism is tracking _estimated_ costs. Connect a cloud-billing source
> (AWS, Pinecone, Qdrant, Azure, GCP, …) to compare against _actual_ vendor charges.
> **[ Connect a billing source ]** → `/settings/integrations` (Billing APIs tab)
> _Small print:_ once connected, the daily sync (01:00 UTC) populates this page; first data appears next day.

Partial state (connections exist but `last_sync_status` is error / never synced) → show the **Connection health**
panel + a banner explaining the sync hasn't succeeded, so a broken sync isn't hidden behind an empty table.

## 6. Data fetching (per CLAUDE.md patterns)

- **Server Component** page; fetch in parallel with `Promise.all`; wrap sections in `<Suspense>` skeletons.
  No `useEffect` + client fetch for initial data.
- Tinybird pipes via `queryTinybird('vector_db_cost_breakdown' | 'infra_cost_breakdown', { org_id, from_date, to_date })`
  (already 30s edge-cached). Supabase via the **session-scoped RLS client** (`createServerClient()`), never the
  admin client — `mcp_cost_reconciliation` + `cloud_billing_connections` both have org-scoped RLS.
- Date range: default last 30d; reuse the dashboard's existing range control if one exists.
- "Sync now" posts to `/api/billing/sync` (returns 202 + job id; poll `billing:sync:job:{id}` or just toast
  "sync started").

## 7. Suggested phasing

1. **P1 — Make it real & honest:** KPI row (estimated/actual/variance/coverage) + Connection-health panel + the
   empty state. Proves the data path end-to-end with minimal surface.
2. **P2 — Variance table** (the resource-level join) + sortable Δ columns.
3. **P3 — Infra mix donut** (`infra_cost_breakdown`) + drill-down to per-operation (`operation_type`:
   read/write/storage) rows.

## 8. Dependencies & open questions

- **[blocker]** Apply migration `20260617000000` to prod before P2 (needs `resource_name`).
- Confirm the canonical estimate source for **LLM** spend on this page (likely `overview_metrics` /
  `infra_cost_breakdown.llm_inference`) vs. vector/MCP estimates (`vector_db_cost_breakdown`).
- Decide whether per-event manual reconciliations (`/api/mcp/reconcile`, which _do_ carry `estimated_cost`)
  get their own "event-level variance" sub-view, or fold into the resource rollup.
- "Sync now" UX: 202 + background job — show a toast, or block with a spinner + poll? Recommend toast.
