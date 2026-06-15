# PRD-6 — Deep Tracing & Debugging

> **Phase:** 3 (Advanced) · **Status:** Draft for review · **Depends on:** PRD-0 (payloads/spans) ·
> **Complements:** existing `agent_loop_detection` ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism ingests OTLP but **keeps only LLM spans** (retrieval/tool/custom spans are dropped) and stores
**no payloads**, so debugging is shallow. Competitors offer full span trees with payloads, timing
waterfalls, error inspection, and replay. This matters most for **agentic AI** — answering "why did
this agent make 27 tool calls and cost $4?" — which ties directly to our existing
`agent_loop_detection`.

## 2. Current state (code anchors)
- `/api/otel/v1/traces` + `lib/otel/mapper.ts` — maps **LLM spans only**; everything else is
  `skipped`.
- `tinybird/pipes/trace_tree.pipe`; span hierarchy on `llm_events`
  (`trace_id`/`span_id`/`parent_span_id`); `tinybird/pipes/agent_loop_detection.pipe`.
- Sessions pages; `/api/traces` + `/api/traces/[traceId]`.

## 3. Competitive context
Langfuse/LangSmith — run-tree debugging + latency-bottleneck identification; Arize — OTEL spans;
Datadog — agent monitoring + waterfalls. Best practice: full span tree **including tool/retrieval
spans**, payloads, timing waterfall, error clustering, replay.
*Sources: [LangSmith observability](https://docs.langchain.com/langsmith/observability), [agent observability comparison](https://www.digitalapplied.com/blog/agent-observability-platforms-langsmith-langfuse-arize-2026).*

## 4. Goals / Non-goals
**Goals:** retain non-LLM spans (retrieval/tool/custom); payload-rich span inspector; timing
waterfall; error clustering; span replay/re-run (ties to PRD-4 playground). **Non-goals:** content
capture itself (PRD-0), the eval scorers (PRD-1).

## 5. Division value
- **Engineering** — debug agents/chains (the "27 tool calls" question).
- **Data Science** — inspect RAG/chain steps.
- **Product** — follow whole conversation arcs.

## 6. Functional requirements
- Mapper **retains tool/retrieval spans** (`span_kind`).
- **Span detail panel**: inputs/outputs (PRD-0), timing, tokens/cost, errors.
- **Waterfall** view of a trace.
- **Error clustering** (group by error type/message).
- **Replay** a span against a prompt/model (PRD-4 playground).

## 7. Data model
- Extend `lib/otel/mapper.ts` to keep tool/retrieval spans; add `span_kind` + error attributes
  (in `llm_events.attributes` or a dedicated `spans` DS).
- Optionally a dedicated Tinybird `spans` datasource for non-LLM spans.
- `trace_tree` pipe extended for mixed span kinds.

## 8. API & SDK surface (TS + Python parity)
- OTEL mapper changes (server-side).
- `/api/traces` + `/api/traces/[traceId]` enrichment.
- SDK span helpers (optional manual spans for custom steps).

## 9. UX / dashboard pages
- **Trace waterfall** + **span detail panel** (extend the `trace_tree` UI).
- **Error explorer** (clusters).
- **Replay** button on a span.

## 10. Phased task breakdown + acceptance criteria
- **P6.1 Span retention.** *AC:* tool/retrieval spans appear in a trace (no longer skipped).
- **P6.2 Waterfall UI.** *AC:* a multi-step trace renders as a timed waterfall.
- **P6.3 Payload/detail panel** (PRD-0). *AC:* per-span inputs/outputs visible (redacted).
- **P6.4 Error clustering.** *AC:* failing spans grouped by error signature.
- **P6.5 Replay.** *AC:* a span re-runs against a chosen model in the playground.

## 11. Dependencies
**PRD-0** (payloads). Complements `agent_loop_detection`. Replay integrates with **PRD-4**.

## 12. Success metrics / KPIs
MTTR on agent bugs; % of spans with full detail; error clusters surfaced.

## 13. Risks & open questions
- **Span volume/cost** → sampling + TTL.
- **OTEL semantic-convention variance** across frameworks → normalize in the mapper.
- **Replay side effects** → sandbox / read-only re-run.

## 14. Out of scope (code-analysis doc to follow)
Mapper diff, waterfall component spec, `spans` DS schema — in the PRD-6 code-analysis doc.
