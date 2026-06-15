# PRD-3 — Feedback & Annotation Queues

> **Phase:** 1 (Quality core) · **Status:** Draft for review · **Depends on:** PRD-0 (reviewer context),
> PRD-1 (edge/disagreement triggers) · **Feeds:** PRD-2 (datasets), fine-tune sets ·
> **Runs parallel with:** PRD-1 ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism can *store* human scores (`eval_scores.scorer_type='human'`) but has **no way to collect
end-user feedback** (thumbs) and **no annotation queue/UI** for human review. Human-in-the-loop closes
a gap every competitor has — and it produces the **ground truth** that calibrates PRD-1's judges and
fills PRD-2's datasets. Research shows **span-level** feedback yields ~9× more training pairs for only
+9% annotation time, and context-rich review (full conversation arc) produces materially better labels.

## 2. Current state (code anchors)
- `eval_scores` accepts `scorer_type='human'` via `POST /api/evaluations/scores` (comment notes it
  is "called by the scorer engine or by external integrations sending human feedback").
- `is_edge` (score < 0.7) edge flagging in `lib/engine/validator.ts`.
- Trace/session linkage on every event; sessions pages exist (`dashboard/sessions`,
  `projects/[id]/observability/sessions`).
- **Missing:** an end-user feedback ingest path/SDK, and any annotation queue or reviewer UI.

## 3. Competitive context
Langfuse/LangSmith ship annotation queues + user-feedback scores; Braintrust + Comet ship human
review workflows. Best practice: route **judge disagreement / low confidence / edge cases** to humans;
annotate with **full context**; support **span-level** annotations.
*Sources: [Comet human-in-the-loop](https://www.comet.com/site/blog/human-in-the-loop/), [Latitude human-aligned eval](https://latitude.so/blog/human-aligned-llm-evaluation-production-workflow).*

## 4. Goals / Non-goals
**Goals:** (a) end-user feedback SDK (thumbs/score/comment) linked to trace/span/session; (b)
annotation queue auto-populated from edge/disagreement/sampling, with a reviewer UI showing full
context (PRD-0) and span-level annotation; (c) export annotations → datasets (PRD-2) / fine-tune.
**Non-goals:** the judge itself (PRD-1), dataset internals (PRD-2).

## 5. Division value
- **Product** — CSAT / thumbs aggregation per feature.
- **Data Science** — training pairs + human-aligned eval; **calibrates the PRD-1 judges**.
- **Support / Ops** — structured review of edge cases.

## 6. Functional requirements
- **Feedback ingest** (end-user) → `feedback` row (+ optional `eval_scores` human score).
- **Queue population rules**: `is_edge`, judge disagreement (PRD-1), random sample, low confidence.
- **Reviewer workspace**: conversation context, span tree, score + comment, accept/reject; span-level
  annotation.
- **Export** annotations to a dataset (PRD-2).

## 7. Data model
- **Supabase `feedback`**: `id, org_id, project_id, source (end_user|reviewer), trace_id, span_id,
  session_id, value, comment, created_at`.
- **Supabase `annotation_queue`**: `id, org_id, trace_id, span_id, status (pending|in_review|done),
  assignee, priority, reason, created_at`.
- Human review scores continue to land in `eval_scores` (`scorer_type='human'`) for unified scoring.

## 8. API & SDK surface (TS + Python parity)
- `POST /api/feedback` (key-scoped; usable by an end-user widget or the SDK).
- `GET/POST/PUT /api/annotations/queue` (list / claim / submit).
- SDK `prism.feedback({ traceId, spanId?, value, comment? })` (TS + Py).

## 9. UX / dashboard pages
- **Annotation queue** page (`/dashboard/quality/annotations` or under `observe`).
- **Reviewer workspace** with full conversation context (PRD-0) + span tree.
- **Feedback widgets** embedded in trace/session detail; **thumbs aggregation** surfaced to Product per
  feature.

## 10. Phased task breakdown + acceptance criteria
- **P3.1 Feedback ingest + SDK.** *AC:* `prism.feedback(...)` lands a `feedback` row linked to a trace.
- **P3.2 Queue model + population rules.** *AC:* edge cases auto-enqueue.
- **P3.3 Reviewer UI with context.** *AC:* reviewer sees full conversation + scores/comments an item.
- **P3.4 Span-level annotation.** *AC:* a single span can be annotated.
- **P3.5 Export to datasets.** *AC:* selected annotations become a PRD-2 dataset.

## 11. Dependencies
**PRD-0** (reviewer context), **PRD-1** (edge/disagreement triggers). **Feeds PRD-2** (datasets) and
closes the judge-calibration loop with PRD-1.

## 12. Success metrics / KPIs
Feedback volume; queue throughput (items/reviewer/day); annotation→dataset conversion; **judge↔human
agreement** (the loop-closing metric with PRD-1).

## 13. Risks & open questions
- **Reviewer bottleneck** → prioritized queue (worst/edge first).
- **Feedback spam/abuse** → key-scoping + rate limits.
- **PII in comments** → redact via the PRD-0 masker.

## 14. Out of scope (code-analysis doc to follow)
Feedback widget components, SDK API shape, queue prioritization algorithm — in the PRD-3 code-analysis
doc.
