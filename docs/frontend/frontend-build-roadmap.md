# Prism — Frontend Build Roadmap (greenfield)

> **Status:** Source of truth for all frontend work. **Supersedes `docs/frontend/pending-ui.md`** (now deprecated).
> **Created:** 2026-06-16 · **Mode:** greenfield — the frontend is (re)built from scratch except sign-in + onboarding.
> **Scope:** the entire repo surface — public/marketing, auth, the authenticated app (analytics, quality & intelligence,
> observability, operations, settings/configuration, account/enterprise), internal admin, and project-scoped views.

## Why this exists
The backend has raced far ahead of the UI: the gateway, both SDKs, 19 migrations (PRD‑0→8 applied), **47 Tinybird pipes**,
**38 `/api/metrics/*` routes**, and the full `/api/{keys,provider-keys,projects,team,evaluations,prompts,annotations,feedback,copilot,traces,content,billing,onboarding}`
surface are shipped. The product app, however, is being treated as **greenfield**: every page is built fresh so the app
is cohesive, retaining only `/login` and `/onboarding`. This document enumerates **every screen and flow**, says **what each
should contain (functional scope only — no visual/design prescriptions)**, and sequences the work **by product area** with
**build stages, priorities, and dependencies** (no time estimates).

## How to read this
- **Status of every screen:** *to build* (greenfield). Retained: `/login`, `/onboarding`.
- **Priority:** `P0` foundation · `P1` high · `P2` medium · `P3` later.
- **Stage:** `S0` foundations → `S1` core FinOps → `S2` ops/config → `S3` observability → `S4` quality/dev-loop → `S5` intelligence/revenue/public.
- **Division:** Fin (Finance/FinOps) · Sales · Prod (Product) · Eng · DS (Data Science) · Exec · Compliance.
- **No design recommendations:** entries describe *scope* — views, KPIs, breakdowns, filters, drill-downs, actions, states, and backing data. They do not prescribe layout, visuals, or component choices.
- **Feature scope is data-grounded:** metrics/columns referenced come from the actual Tinybird pipes (§8) and `/api/metrics/*` routes.

---

## 0. Snapshot
- **Raw tree:** **86 `page.tsx`** under `apps/web/app` (includes duplicate/legacy routes collapsed in §2). **2 retained** (`/login`, `/onboarding`); all other page bodies rebuilt.
- **Canonical target after IA de-duplication:** ~**90–100 unique pages** + ~**35–45 sub-surfaces** (create/edit dialogs, slide-overs, tabbed sub-views, the payload viewer, trace waterfall, reviewer workspace, Copilot panel) → **~130–150 distinct screens/designs**. Per-area counts in §4.
- **Data surface:** 47 pipes (45 endpoints + 2 views: `llm_events_filtered`, and `export_*` utilities); 38 metrics routes. **Pipes with no read route:** `sessions_list`, `max_cost_per_call`, `gateway_enforcement_trends`, `sdk_bypass_coverage` (+ `export_*` are non-UI). **Supabase/Redis-backed routes** (no Tinybird): `/api/metrics/{drift,reconciliation,provider-health,budget-status,circuit-breakers,stream,infra-breakdown,vector-db,customers,account-overview}`.
- **Reusable infrastructure (not pages, retained):** dashboard shell (`app/dashboard/layout.tsx`), `components/ui/*` (shadcn), `components/patterns/*` (`PageHeader`, `KpiCard`, `ChartCard`, `DataTable`, `EmptyState`, `StatusBadge`, `ConfirmDialog`, `TimeRangePicker`), `components/charts/*` (Recharts wrappers), `components/widgets/*` (`DashboardCanvas` + registry), role context (`useRole`/`useCanManage`), and the API client (`@/lib/api/client`: `apiGet` + react-query). The reference page pattern is `app/dashboard/page.tsx`.

---

## 1. Foundations & cross-cutting (S0 · P0)
These gate all area work and are built once, then reused.

- **Design-system decision (decision only):** adopt the existing component library as-is, or refresh it. (No design opinion offered here.)
- **App shell:** dashboard layout, sidebar, topbar, RoleProvider, org/project/environment switchers, command palette (cmdk), theme toggle, notifications bell, onboarding gate, and unauthenticated→`/login` redirect.
- **Canonical IA / route map (§2):** finalize the nav tree first so duplicate routes are never built twice.
- **Global filter bar:** org (implicit) · project/project_ids · environment · provider · model · date range — these mirror the common pipe params (`from_date`/`to_date`/`project_id`/`project_ids`/`environment`/`provider`/`model`) so every analytics screen filters consistently.
- **Shared surfaces (build once, reuse everywhere):**
  - **Payload viewer** — prompt/completion/retrieved-context/tool-IO with redaction badges + "request log access" CTA on 403 (`/api/content/[eventId]`).
  - **Trace waterfall + span detail** — multi-kind span tree (`/api/traces/[traceId]` → `trace_tree`; spans: llm/tool/retrieval/chain/custom).
  - **Copilot panel** — global NL chat surface integrated with the command palette.
  - **Export/CSV affordance**, and standard **loading / empty / first-run / error** states (many features start empty until capture or crons run).
- **AuthZ in the UI:** gate write controls with `useCanManage`/`useRole` to mirror the server RBAC (owner/administrator/developer/read_only; organization vs project scope; project grants via `member_project_roles`).

---

## 2. Canonical information architecture (resolve duplicate routes by design)
The raw tree contains overlapping routes. Build the canonical one and redirect the rest:

| Concern | Canonical | Collapsed / redirected |
|---|---|---|
| Arena / Playground | `dashboard/workbench/arena` | `dashboard/arena` |
| Evals workbench | `dashboard/workbench/evals` | `dashboard/evals` |
| Models | `dashboard/models` | `dashboard/spend/models` |
| Agents / MCP | `dashboard/agents` (org) + `observe/mcp` (operational) — pick one home, link the other | — |
| Team | `dashboard/teams` | `dashboard/team` |
| Integrations | `dashboard/settings/integrations` | `dashboard/integrations` |
| Control plane | fold `dashboard/control/{keys,router,alerts,engine}` + `dashboard/govern` into Settings (`api-keys`, `routing`, `alerts`, `model-governance`) + `dashboard/engine` | `dashboard/control/*`, `dashboard/govern` |

**Final nav groups:** Public (marketing) · Auth · **Analytics · Quality & Intelligence · Observability · Operations · Settings · Account (enterprise) · Admin (internal)**.

---

## 3. Build stages (what comes online at each stage)
| Stage | Theme | Primary divisions | Highlights |
|---|---|---|---|
| **S0** | Foundations | All | Shell, canonical IA, filter bar, shared surfaces, RBAC gating |
| **S1** | Core FinOps read | Fin, Exec | Overview, FinOps, Models, Spend suite, Unit Economics, Projects + project overview, Alerts |
| **S2** | Ops & configuration | Exec, Fin (admin), Eng | All Settings + config flows, Team/members/invite, Account/org settings, my-keys, signup, join |
| **S3** | Observability depth | Eng, DS | Sessions+detail, Logs, Agents/Observe, deep-trace waterfall + payloads, Errors, project observability, Training |
| **S4** | Quality & dev loop | Eng, DS, Prod | Quality+configs+alerts, Annotations+feedback, Prompts, Datasets/Experiments/Compare/Playground, Drift |
| **S5** | Intelligence, revenue & public | All, Sales | Copilot, Customers P&L, marketing/legal, admin, enterprise SSO; deferred items |

---

## 4. Build specs by product area
Each table: **Screen/Route · Feature scope (functional) · Backing data · Pri · Stage · Deps.** Sub-surfaces (dialogs/sheets/panels) listed under each area.

### 4.1 Auth & Onboarding — Eng/all
| Screen | Feature scope | Backing | Pri | Stage |
|---|---|---|---|---|
| `/login` (retained) | email + OAuth sign-in | Supabase auth | — | — |
| `/onboarding` (retained) | org name, plan, consent, first project/key | `/api/onboarding/*` | — | — |
| `/signup` | email + OAuth sign-up | Supabase auth | P1 | S2 |
| `/join` | accept an invite → join org/project | `pending_invites`, `/api/team/invite/claim` | P1 | S2 |

### 4.2 Public / Marketing — Exec/Sales
| Screen | Feature scope | Pri | Stage |
|---|---|---|---|
| `/` landing | product value, CTAs | P2 | S5 |
| `/pricing` | plan tiers + feature matrix | P2 | S5 |
| `/how-it-works`, `/docs`, `/roadmap` | explainer / docs / public roadmap | P3 | S5 |
| `/privacy`, `/terms` | legal (needed for compliance) | P2 | S5 |

### 4.3 Analytics — Fin/Exec/DS  (S1, P1 unless noted)
| Screen | Feature scope | Backing | Pri | Stage |
|---|---|---|---|---|
| `/dashboard` Overview | KPI row (cost, requests, tokens, error rate); spend trend; spend by project/model; MCP KPI row; anomaly callout; recent activity; role-aware empty state | `overview_metrics`, `timeseries_daily`, `spend_by_project`, `spend_by_model`, `mcp_overview_metrics`, `anomaly_detection` | P1 | S1 |
| `/dashboard/finops` | vendor spend table + sparklines; budget tracker; cost centers; unified infra breakdown; efficiency trend; anomalies; drill to project/model/center | `spend_by_provider`, `/api/metrics/budget-status`, `spend_by_cost_center`, `infra_cost_breakdown`, `vector_db_cost_breakdown`, `efficiency_timeseries`, `anomaly_detection` | P1 | S1 |
| `/dashboard/models` | per-model cost/requests/tokens, **cache_hit_rate**, **tokens_per_dollar**, output/input ratio, error_rate, avg latency; efficiency trend; provider health; TTFT percentiles; **quality-per-model overlay** | `spend_by_model`, `efficiency_timeseries`, `/api/metrics/provider-health`, `ttft_percentiles`, `quality_by_model` (S4) | P1 | S1 |
| `/dashboard/unit-economics` | cost by feature; cost by action; action-definitions editor (cost_per_action); ROI / cost-per-outcome (success/fail, value_usd, roi_ratio); session cost percentiles; **cost-per-good-response** overlay; drill to traces | `spend_by_feature`, `spend_by_action`, `action_definitions`, `cost_per_outcome`, `session_cost_distribution` | P1 | S1 |
| `/dashboard/spend/cost` | cost trends (daily/hourly) | `timeseries_daily`, `timeseries_hourly` | P2 | S1 |
| `/dashboard/spend/attribution` | attribution by project/team/user/key/branch/workload | `spend_by_{project,team,user,key,branch,branch_developer,workload}` | P2 | S1 |
| `/dashboard/spend/billing` | billing reconciliation (estimated vs actual) | `/api/metrics/reconciliation` | P2 | S1 |
| `/dashboard/spend/infrastructure` | infra + vector-DB cost breakdown | `infra_cost_breakdown`, `vector_db_cost_breakdown` | P2 | S1 |
| `/dashboard/spend/training` | training/fine-tune run costs | `training_cost_summary` | P3 | S3 |
| `/dashboard/engine` | recommendation cards + narratives + apply-action overlay | `/api/metrics/recommendations`, `lib/engine/*` | P2 | S1/S2 |
| `/dashboard/logs` | request-log explorer + filters; row → trace/payload | `llm_events_filtered`, `request_logs` | P2 | S3 |

Sub-surfaces: action-definition create/edit dialog; filter bar (shared); chart drill-down panels.

### 4.4 Agents & MCP / Observe — Eng/DS/Fin  (S3, P2)
| Screen | Feature scope | Backing |
|---|---|---|
| `/dashboard/agents` | MCP KPIs; cost by server; cost by tool (calls/errors/cost/latency/actual-vs-estimated); tool breakdown; **agent loop detection** → drill to session | `mcp_overview_metrics`, `spend_by_mcp_server`, `spend_by_mcp_tool`, `tool_breakdown`, `agent_loop_detection`, `/api/metrics/mcp/*` |
| `/dashboard/observe/mcp` | operational MCP view (calls, errors, latency) | `mcp_overview_metrics`, `spend_by_mcp_tool` |
| `/dashboard/observe/shadow-it` | unmanaged services + SDK-bypass + gateway-enforcement trends | `enforce_checkins`, `sdk_bypass_coverage`*, `gateway_enforcement_trends`* (*need read routes) |
| `/dashboard/observe/tool-pricing` | tool cost catalog + vector-DB pricing | `tool_cost_catalog`, `vector_db_cost_breakdown` |

### 4.5 Sessions & Observability (org-level) — Eng/Prod/DS  (S3, P2)
| Screen | Feature scope | Backing |
|---|---|---|
| `/dashboard/sessions` | session list (cost/duration/calls/tools/models) + cost-percentile row + reconciliation badges | `sessions_list`* (*needs read route), `session_cost_distribution` |
| `/dashboard/sessions/[id]` | per-call timeline (LLM + tool); cost/latency/tokens; payloads (payload viewer); feedback widget (S4) | `/api/traces/[traceId]`, `trace_tree`, `/api/content/[eventId]`, `/api/feedback` |

Sub-surfaces: payload viewer (shared); trace waterfall (shared); feedback widget.

### 4.6 Quality & Intelligence (PRD suite) — Eng/DS/Prod  (S4 unless noted)
| Screen | Feature scope | Backing | Pri | Stage |
|---|---|---|---|---|
| Content-capture settings (PRD‑0) | per-project level (off/metadata/redacted/full), payload TTL, embeddings on/model, residency override; privacy explainer + audit link | `/api/settings/content-capture`, `content_capture_settings` | P1 | S2 |
| Payload viewer (PRD‑0) | shared surface (see §1) | `/api/content/[eventId]` | P1 | S3 |
| `/dashboard/quality` (PRD‑1) | score trend; pass-rate & avg-score KPIs; by-model; by-scorer (rubric/faithfulness/answer_relevancy/context_precision/context_recall/toxicity/hallucination); edge-case list → trace | `/api/metrics/quality` → `quality_timeseries`, `quality_by_model`, `quality_by_scorer` | P1 | S4 |
| Quality → configs tab (PRD‑1) | list/create/edit eval configs: judge model, rubric, scorers multiselect, sampling rate/tiers, scope (project/model), enable | `/api/evaluations/configs` | P1 | S4 |
| `/dashboard/quality/annotations` (PRD‑3) | prioritized queue (status/reason); reviewer workspace (conversation context + span tree; score + comment + accept/reject; span-level); export-to-dataset | `/api/annotations/queue` + `/[id]`, `/api/annotations/export`, payload viewer | P2 | S4 |
| Feedback widgets + thumbs aggregation (PRD‑3) | 👍/👎 + comment on trace/span; existing feedback for a trace; per-feature up-rate | `/api/feedback` | P2 | S4 |
| `/dashboard/prompts` + `/[id]` (PRD‑4) | list (name/latest/labels); immutable version history + **diff**; label promote (prod/staging); add version; spend-by-prompt-version | `/api/prompts/*`, `spend_by_prompt_version` | P1 | S4 |
| `/dashboard/workbench/evals` (PRD‑2) | **Datasets** (CRUD inline samples; **from-traces**); **Experiments** (run: subject model/prompt/params, scorers, judge, baseline+threshold; list); **Compare** (per-scorer deltas + regression badge); CI gate snippet | `/api/evaluations/{datasets,datasets/from-traces,experiments,scores?run_ids=}` | P2 | S4 |
| `/dashboard/workbench/arena` Playground (PRD‑4) | load a prompt version, fill variables, run vs N models, compare output + cost + score, save-as-version | `/api/prompts/resolve`, `/api/arena/chat` | P2 | S4 |
| `/dashboard/quality/drift` (PRD‑5) | drift trend by segment/metric (PSI/JS/centroid_cosine); cluster/topic explorer; drift alert config; embedding projection scatter **(blocked — no projection endpoint)** | `/api/metrics/drift` (Supabase: `drift_metrics`, `clusters`) | P2 | S4 (projection → S5) |
| `/dashboard/quality/errors` (PRD‑6) | error clusters (signature/source/occurrences/last_seen) → drill to traces | `/api/metrics/errors` → `error_clusters` | P2 | S3/S4 |
| Copilot (PRD‑7) | global chat (answer + provenance + inline data); investigation/RCA view; "explain this" chart buttons; conversation history | `/api/copilot/chat`, `/api/copilot/investigate` | P2 | S5 |

Sub-surfaces: eval-config create/edit; dataset create + from-traces dialog; experiment-run sheet; compare view; prompt version-add + label-promote + diff; reviewer workspace; Copilot panel; drift cluster drill.

### 4.7 AI Product P&L / Customers (PRD‑8) — Sales/Fin/Exec  (S5, P2)
| Screen | Feature scope | Backing |
|---|---|---|
| `/dashboard/customers` | customer list (cost-to-serve); **revenue** (sync/api/manual/modeled), **gross margin %**, margin trend, unprofitable flag; sort by margin | `spend_by_customer`, `customer_quota_profiles`, revenue source (**backend gap**) |
| `/dashboard/customers/[id]` | daily spend + model breakdown; revenue + margin detail | `customer_timeseries_daily`, `customer_model_breakdown` |
| P&L view | margin by customer & plan; at-risk / upsell; cost-to-serve breakdown | above + rate cards |

Sub-surfaces: revenue connector card (Settings → Integrations); rate-card editor; identity-mapping dialog; margin alert. **Backend gap:** revenue ingestion (`POST /api/revenue`, rate cards, billing sync) — flag as build-needed.

### 4.8 Operations — Eng/Fin/DS
| Screen | Feature scope | Backing | Pri | Stage |
|---|---|---|---|---|
| `/dashboard/alerts` | list + create across **12 trigger types** (budget_threshold, spend_spike, statistical_anomaly, error_rate, single_call_cost, daily_limit, tool_call_loop, session_budget_threshold, velocity_spike, pii_detection, drift, quality_drop); threshold, channels (email/slack/webhook), scope, enable; firing history | `alert_rules` (**verify CRUD API**) | P1 | S1 |
| `/dashboard/projects` | project grid + create → project tree (§4.11) | `/api/projects` | P1 | S1 |
| `/dashboard/my-keys` | per-user keys + SDK setup snippet | `/api/keys` (user scope) | P2 | S2 |
| `/dashboard/training` | training/fine-tune run costs + sync | `training_cost_summary`, `training_runs` | P3 | S3 |

### 4.9 Settings & Configuration — Exec/Fin/Eng admin  (S2, P1–P2)
Tab shells: `/settings/{access,integrations,compliance,privacy}` render child config screens. Each child is a **config flow** (steps in §5).
| Screen | Feature scope | Backing | Pri |
|---|---|---|---|
| `/settings/api-keys` | list/create/rotate/revoke/expiry; multi-period caps; provider-key links + primary; extension requests; usage | `/api/keys/*`, `key_caps`, `key_provider_links`, `spend_by_key`, `key_timeseries` | P1 |
| `/settings/provider-keys` | add/encrypt; allowed_models; data_region; custom/azure/bedrock endpoints; use_for_reconciliation; link to keys | `/api/provider-keys/*` | P1 |
| `/settings/routing` | fallback chains + proactive routing policies | `model_routing_rules`, `routing_policies` (**verify API**) | P2 |
| `/settings/model-governance` | allow/block/requires-approval per model + approval queue | `org_model_policies`, `model_approval_requests` (**verify API**) | P2 |
| Guardrails (under privacy/integrations) | profiles (PII/Bedrock/Azure) + rules (warn/block/redact; input/output; sampling; priority); PII incidents | `guardrail_profiles`, `guardrail_rules`, `pii_incidents` (**verify API**) | P2 |
| `/settings/billing` (+ `/dashboard/billing`) | plan/subscription (Stripe/Razorpay), usage, seats, region | `organizations` + webhooks | P2 |
| `/settings/billing-apis`, `/settings/connections` | cloud billing connections (AWS/Pinecone/Qdrant) + sync status; export destinations | `cloud_billing_connections`, `export_destinations` | P2 |
| `/settings/compliance` (+ `/reconciliation`) | audit log; reconciliation; content-capture; data residency | `audit_log`, `/api/logs`, `/api/metrics/reconciliation`, `mcp_cost_reconciliation` | P2 |
| `/settings/privacy` | org PII detect/mask config; guardrails entry | `organizations` PII config | P2 |
| `/settings/{access,enforce,shadow-it}` | keys + policies + enforce summary; check-in approval | `enforce_checkins`, `sdk_bypass_events` | P3 |
| Eval configs / Copilot settings | eval configs surfaced in Quality; Copilot settings (auto-RCA, self-cost cap, scope) | `/api/evaluations/configs`; Copilot config | P2 |

### 4.10 Team / Members / Access — Exec/Fin  (S2, P1)
| Screen | Feature scope | Backing |
|---|---|---|
| `/dashboard/teams` | members list; invite (email/role/scope); role change; project grants; SSO-only invites; teams for attribution | `/api/team/*`, `members`, `member_project_roles`, `pending_invites`, `teams`, `team_members` |

### 4.11 Project-scoped views `/dashboard/projects/[id]/*` — Eng/DS/Fin
All currently empty files. Build with `project_id`/`project_ids` pipe params + project RBAC.
| Screen | Feature scope | Pri | Stage |
|---|---|---|---|
| `/projects/[id]` overview | project KPIs (cost/requests/quality summary) | P1 | S1 |
| `/observability` + `/logs` `/sessions` `/traces` `/agents` | project-filtered logs/sessions/traces/agents + trace tree | P1/P2 | S3 |
| `/spend` | project-scoped spend breakdown | P2 | S1 |
| `/keys` + `/caps` + `/requests` | project keys + caps + extension requests | P2 | S2 |
| `/enforcement` | enforcement stats for the project | P3 | S3 |
| `/governance` | model governance (project view) | P3 | S3 |
| `/settings` | project budget, cost_center, content-capture | P2 | S2 |

### 4.12 Account / Enterprise — Exec/Compliance  (S5, P3)
| Screen | Feature scope | Backing |
|---|---|---|
| `/dashboard/account/overview` | org settings: data residency, gateway mode, PII, cache | `organizations` |
| `/dashboard/account/members` | enterprise members | `members` |
| `/dashboard/account/sso` | SAML/OIDC config | `sso_configs` |

### 4.13 Admin (internal) — S5, P3
| Screen | Feature scope | Backing |
|---|---|---|
| `/admin/features` | feature-flag / feature-guard config | feature-guard store |

### 4.14 Dev tooling
| Screen | Feature scope |
|---|---|
| `/dashboard/dev/gallery` | optional internal component showcase (rebuild only if useful) |

---

## 5. Configuration & multi-step flows (explicit steps; no design)
1. **API-key lifecycle** — create (org/project scope) → list → set multi-period caps (`key_caps`) → link provider keys + set primary (`key_provider_links`) → rotate → revoke → expiry → extension request/approve. Routes: `/api/keys/*`.
2. **Provider-key setup** — add + encrypt → allowed_models / data_region / custom|azure|bedrock endpoint → use_for_reconciliation → link to keys → deactivate. Routes: `/api/provider-keys/*`. Tables: `provider_keys`, `key_provider_links`.
3. **Model routing / fallback** — primary → fallback chain + trigger codes + activate; optional proactive `routing_policies` (condition→action). Tables: `model_routing_rules`, `routing_policies`. (Verify route.)
4. **Model governance + approval** — define allow/block/requires-approval per model+env; user requests blocked model → admin approve/reject. Tables: `org_model_policies`, `model_approval_requests`.
5. **Alert creation** — pick trigger (12 types) → threshold → channels (email/slack/webhook) → scope (org/project) → enable; firing history. Table: `alert_rules`.
6. **Budgets & cost centers** — org/project/provider/user budget → alert % → hard-cap toggle; project `cost_center_code`. Table: `budgets`, `projects`.
7. **Cloud billing connection** — add AWS/Pinecone/Qdrant creds (encrypted) → enable → sync → status/errors. Tables: `cloud_billing_connections`, `mcp_cost_reconciliation`.
8. **Member invite + roles + project grants** — invite (email/role/scope, optional SSO-only) → accept (`/join`) → org role + per-project grants. Tables: `pending_invites`, `pending_invite_projects`, `members`, `member_project_roles`.
9. **Guardrail profile + rules** — create profile (builtin PII / Bedrock / Azure) → add rule(s) (warn/block/redact; input/output/both; sampling; priority; condition) → enable. Tables: `guardrail_profiles`, `guardrail_rules`.
10. **Content-capture** — per-project level (off→full) → TTL → embeddings on/model → residency override. Table: `content_capture_settings`.
11. **Eval config** — judge model → rubric → scorers → sampling rate/tiers → scope → enable. Table: `eval_configs`.
12. **Prompt versioning + labels** — create prompt → add immutable version (messages + config + commit msg) → move labels (prod/staging) → resolve. Tables: `prompts`, `prompt_versions`, `prompt_labels`.
13. **Annotation review + export** — queue (claim/skip) → reviewer workspace (score + comment + span) → submit (writes `eval_scores` human) → export to dataset. Tables: `annotation_queue`, `eval_scores`.
14. **Onboarding (retained)** — signup → org name → plan → consent → first project/key. Routes: `/api/onboarding/*`.
15. **Org settings** — data residency · gateway mode · PII detect/mask · cache mode/TTL. Table: `organizations`.
16. **Revenue ingest (PRD‑8)** — billing sync (Stripe/Metronome/Orb) | `POST /api/revenue` + SDK | manual CSV | modeled (usage × rate card); identity mapping (billing ID ↔ `customer_id`); currency. **Backend gap — build needed.**

---

## 6. Dependency graph & blockers
- **S0 foundations** gate all area work; **canonical IA (§2)** precedes builds (avoids double-building duplicate routes).
- **PRD‑0 content-capture + payload viewer** → unblock: quality drill-downs, annotation reviewer workspace, from-traces datasets, session/trace payload panels, error span detail.
- **PRD‑4 prompts** → unblock: PRD‑2 prompt-as-experiment-subject + playground.
- **Alerts page** hosts `quality_drop` (PRD‑1) + `drift` (PRD‑5) alert configs.
- **Backend gaps to build before/alongside their UI:** `sessions_list` read route; read routes for `gateway_enforcement_trends`, `sdk_bypass_coverage`, `max_cost_per_call`; **drift embedding-projection endpoint**; **PRD‑8 revenue ingestion**; **verify/likely-build** CRUD APIs for alerts, routing, governance, guardrails, budgets, export-destinations, tool-cost-catalog, billing-connections.

---

## 7. Staged rollout summary ("what exists at each stage")
- **S0** — shell, canonical IA, global filter bar, shared surfaces (payload viewer / trace waterfall / Copilot panel scaffolds), RBAC gating. → app is navigable.
- **S1** — Overview, FinOps, Models, Spend suite, Unit Economics, Projects list + project overview + project spend, Alerts (view+create). → Finance/Exec value live.
- **S2** — all Settings + every config flow (keys/caps/provider-links, provider keys, routing, governance+approvals, guardrails, billing, billing-APIs/connections, compliance, privacy, audit, content-capture, eval-configs), Team/members/invite, Account/org settings, my-keys, signup, join, project keys/settings. → platform self-serve operable.
- **S3** — Sessions list+detail, Logs, Agents/Observe, deep-trace waterfall + span detail + payloads, Error explorer, project observability (logs/sessions/traces/agents), Training. → Eng/DS debugging.
- **S4** — Quality dashboard + configs + alerts, Annotations + feedback, Prompts + versions + labels, Datasets + from-traces + experiments + compare + playground, Drift + clusters. → quality & dev loop.
- **S5** — Copilot (chat + investigation + explain-this), Customers P&L (revenue + margin), marketing/legal pages, admin/features, enterprise SSO/members; deferred (drift projection scatter, Copilot SSE/auto-invoke, SDK manual spans). → differentiation & GTM.

---

## 8. Backing-data coverage
- Per-area pipe/route mapping is embedded in §4. Common pipe params: `org_id` (always), `from_date`/`to_date`, `project_id`/`project_ids`, `environment`, `provider`, `model`, `scorer_type`, `segment`/`metric` (drift), `customer_id`, `api_key_id`, `session_id`.
- **Pipes needing a read route before their UI:** `sessions_list`, `max_cost_per_call`, `gateway_enforcement_trends`, `sdk_bypass_coverage` (`export_*` are non-UI).
- **Supabase/Redis-backed metrics routes (no Tinybird):** `/api/metrics/{drift,reconciliation,provider-health,budget-status,circuit-breakers,stream,infra-breakdown,vector-db,customers,account-overview}` — UI consumes these directly.
- **Already-wired metrics routes (38):** overview, timeseries, models, projects, branches(+compare), ttft, vendors, features, cost-centers, key-usage, workload, customers(+[id]/daily,[id]/models), mcp/{overview,servers,tools,loops}, quality, efficiency, anomalies, session-distribution, stream, errors, outcomes, recommendations, reconciliation, team, drift, provider-health, vector-db, infra-breakdown, budget-status, prompt-versions, branch-developers, circuit-breakers, account-overview.

---

## 9. Per-division coverage matrix
| Division | Areas served |
|---|---|
| **Finance / FinOps** | Overview, FinOps, Spend suite, Budgets, Cost centers, Unit Economics, Customers P&L, Alerts |
| **Sales / RevOps** | Customers P&L (revenue/margin/upsell/at-risk), Copilot margin queries |
| **Product** | Unit Economics, Quality-per-feature, Feedback/CSAT, Topic clusters (drift), Sessions |
| **Engineering** | Agents/MCP, Sessions, Logs, Deep tracing/Errors, Experiments/CI gates, Alerts |
| **Data Science** | Models + efficiency, Quality/evals, Datasets/Experiments, Prompts, Drift/clusters, Annotations |
| **Exec / Compliance** | Overview, P&L, Compliance/Audit, Governance, Copilot, Account/SSO |

---

## 10. Notes
- This roadmap is the single source of truth and **supersedes `docs/frontend/pending-ui.md`**.
- Re-verify the §0 counts (`apps/web/app/**/page.tsx`, `tinybird/pipes/*.pipe`) when revisiting.
- Update this file as areas are built — flip a screen's note to "built" with the commit/PR, and record backend-gap closures (e.g., when the `sessions_list` route or revenue ingestion lands).
