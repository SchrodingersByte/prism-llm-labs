# PRD-7 — Prism Copilot (NL Query + Agentic RCA)

> **Phase:** 4 (Differentiator) · **Status:** Draft for review · **Depends on:** can start early on
> existing cost/anomaly data; deepens with PRD-1 (quality) + PRD-5 (drift) ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Today the "engine" produces **rule-based recommendations + templated Haiku narratives** — useful, but
not a genuine AI analyst. The market has moved to **NL query + agentic investigation** (Datadog
Bits AI, Grafana Assistant + Investigations, Azure Copilot observability agent, OpenSearch agentic log
analytics). **Prism Copilot** is a conversational, agentic analyst over Prism's **unified spine
(cost + quality + economics)** — the one place Prism can *lead*, because no competitor has all that
data unified. It reuses `queryTinybird`, the engine driver, the Claude/Haiku plumbing, and the
existing anomaly triggers.

## 2. Current state (code anchors)
- `queryTinybird()` (`lib/tinybird/client.ts`); 40+ pipes = the queryable surface.
- `lib/engine/run.ts` (driver), `lib/engine/narratives.ts` (Claude **Haiku 4.5** via raw fetch),
  `recommendations.ts`, `actions.ts`; `/api/engine/*`.
- `tinybird/pipes/anomaly_detection.pipe` + `spend_velocity_5min.pipe` (triggers).
- `recommendation_actions` overlay (lifecycle for one-click actions).

## 3. Competitive context
Datadog Bits AI + AI agents console; Grafana Assistant + **Investigations** (multi-step RCA); Azure
Copilot observability agent; OpenSearch **agentic** log analytics (NL → analyze → RCA, typically
6–27 queries per investigation). Best practice: a **semantic layer** beats raw text-to-SQL (~90%
accuracy, blocks DML); an **agent loop** (plan → query → refine); a secondary review of generated
queries.
*Sources: [Grafana Assistant Investigations](https://markets.financialcontent.com/chroniclejournal/article/bizwire-2025-10-8-grafana-labs-revolutionizes-ai-powered-observability-with-ga-of-grafana-assistant-and-introduces-assistant-investigations), [OpenSearch agentic analytics](https://aws.amazon.com/about-aws/whats-new/2026/03/opensearch-agentic-ai-log-analytics-observability/), [semantic layer vs text-to-SQL](https://docs.getdbt.com/blog/semantic-layer-vs-text-to-sql-2026).*

## 4. Goals / Non-goals
**Goals:** (a) NL query over pipes via a **semantic layer** (metrics/dimensions catalog → pipe calls,
not raw SQL); (b) **agentic RCA loop** (plan → query → refine) triggered manually or auto on anomaly;
(c) outputs narrative + charts + **recommended actions** (reuse recommendations/actions).
**Non-goals:** replacing dashboards; any **write** actions (Copilot is read-only).

## 5. Division value — the cross-division glue
Every division asks its own questions in its own language:
- **Finance** — "why did spend spike? forecast month-end; which customers are unprofitable?"
- **Product** — "which features dropped in quality after the model swap?"
- **Engineering** — "which agent loops cost the most? where are errors clustering?"
- **Data Science** — "where is drift emerging?"
- **Exec** — "summarize this month."

## 6. Functional requirements
- **Semantic layer** maps NL concepts → existing pipes + params (model/feature/customer/cost-center/
  time window).
- **Planner** selects pipes, executes via `queryTinybird`, refines (agent loop).
- **Agentic RCA** for anomalies (reuse `anomaly_detection` / `spend_velocity_5min` triggers).
- **Recommended actions** via the existing `actions` overlay.
- **Guardrails**: read-only, **org-scoped (RLS/metrics-scope aware)**, self-cost-capped via Prism's
  own gateway (**dogfood**).

## 7. Data model
- **Supabase `copilot_conversations`**: `id, org_id, user_id, title, created_at`.
- **Supabase `copilot_messages`**: `conversation_id, role, content, tool_calls jsonb, created_at`.
- **Semantic-layer metrics catalog** (code module or table) mapping NL concepts → pipes/params.
- Reuses all existing pipes (no new analytics datasources required for v1).

## 8. API & SDK surface
- `POST /api/copilot/chat` (streaming).
- `POST /api/copilot/investigate` (agentic RCA).
- Auto-invoke from anomaly triggers (cron/alerts).

## 9. UX / dashboard pages
- **Global Copilot chat panel** (command palette / sidebar).
- **Investigation results** view.
- **"Explain this"** buttons embedded on dashboard charts.

## 10. Phased task breakdown + acceptance criteria
- **P7.1 Semantic/metrics catalog.** *AC:* NL concepts map to ≥10 core pipes.
- **P7.2 NL→pipe planner.** *AC:* a question returns the right pipe call + answer (read-only).
- **P7.3 Chat API + UI** (streaming). *AC:* multi-turn chat with charts.
- **P7.4 Agentic RCA loop.** *AC:* an anomaly is investigated across multiple pipe queries → narrative.
- **P7.5 Anomaly auto-investigate.** *AC:* a spend spike auto-generates an explanation.
- **P7.6 Action overlay.** *AC:* an investigation proposes a recommendation action.
- **P7.7 Self-metering.** *AC:* Copilot's own LLM spend is tracked via the Prism gateway.

## 11. Dependencies
Can **start early** on existing cost/anomaly data (quick win); deepens as **PRD-1** quality and
**PRD-5** drift data land. Reuses engine driver + narratives + `queryTinybird` + anomaly + actions.

## 12. Success metrics / KPIs
Questions answered without opening a dashboard; anomalies auto-explained; time-to-insight; Copilot
NPS; Copilot self-spend (dogfood signal).

## 13. Risks & open questions
- **Hallucinated insights** → semantic layer + cite the pipes used + secondary review + read-only.
- **Cost** → self-meter + cap via the gateway.
- **Data-scope leakage** → org-scoped queries only; respect `metrics-scope`/RLS.
- **Latency** → stream + cache (`queryTinybird` already edge-caches 30s).

## 14. Out of scope (code-analysis doc to follow)
Semantic-layer schema, planner prompts, agent-loop implementation — in the PRD-7 code-analysis doc.
