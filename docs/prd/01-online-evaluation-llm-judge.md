# PRD-1 — Online Evaluation & LLM-as-Judge (+ RAG & hallucination scorers)

> **Phase:** 1 (Quality core) · **Status:** Draft for review · **Depends on:** PRD-0 (content/context) ·
> **Feeds:** PRD-2 (scorers), PRD-7 (quality data) · **Runs parallel with:** PRD-3 ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism already has an LLM **judge** and a score store — but they only run **on demand** to validate
model-migration recommendations. There is **no continuous scoring of production traffic**, no
RAG/safety scorers, and no quality dashboard/alerts. Online quality is the **#1 table-stakes gap**:
without it, Product/Engineering/DS have no production quality signal and no reason to choose Prism
over Langfuse/LangSmith/Braintrust/Arize. This PRD turns the existing judge into a configurable,
continuously-sampling **online evaluation** system.

## 2. Current state (code anchors)
- `apps/web/lib/engine/validator.ts` — LLM judge (semantic-agreement scoring) with `is_edge`
  (score < 0.7) flagging; driven by `/api/engine/validate` + `/api/engine/validate/[jobId]`.
- `eval_scores` table — `scorer_type ∈ {llm_judge, rule, human}`, `judge_model`, `score` (0–1),
  `passed`, `reason`, `cost_usd`, `latency_ms`, `trace_id`, `span_id`. Written via
  `POST /api/evaluations/scores`; aggregated for Arena via its `GET`.
- `evaluation_runs` table + `GET/POST /api/evaluations`.
- Cron infra: `app/api/cron/*` (e.g. `build-recommendations`, `send-reports`, `reconcile-usage`).
- Alerts: `lib/alerts/evaluator.ts` + `/api/alerts/evaluate`.
- `queryTinybird()` (`lib/tinybird/client.ts`).

## 3. Competitive context
Langfuse/LangSmith run online evals on production traces; Arize ships LLM-as-judge + RAG scorers
(relevance/toxicity/hallucination) **with explanations**; Braintrust ships AutoEvals scorers + drop
alerts. **RAGAS** defines the canonical RAG metrics: faithfulness, answer relevancy, context
precision, context recall. Best practice: version datasets/rubrics/judges; **stratified sampling**
(common / long-tail / adversarial / catastrophic); store criterion-level results with explanations;
**escalate judge disagreement to human** (PRD-3). We already store `reason` + `judge_model` + edge
flags — we are closer than the gap-analysis implied.
*Sources: [RAGAS metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/), [Arize LLM-as-a-judge](https://arize.com/llm-as-a-judge/), [LLM-as-judge best practices](https://medium.com/@QuarkAndCode/llm-evaluation-in-2025-metrics-rag-llm-as-judge-best-practices-ad2872cfa7cb).*

## 4. Goals / Non-goals
**Goals:** configurable online eval (judge model, rubric, scorer set, sampling); RAG scorers
(faithfulness, answer relevancy, context precision/recall); safety scorers (toxicity, hallucination);
a quality time-series + dashboard + alerts. **Non-goals:** dataset/experiment management (PRD-2),
feedback/annotation UI (PRD-3), content capture itself (PRD-0).

## 5. Division value
- **Engineering / Data Science** — automated quality gates + regression detection on live traffic.
- **Product** — quality per feature/model, not just cost.
- **Finance** — **cost-per-good-response** by fusing `eval_scores` with `outcome_events` + cost
  (a metric no competitor can compute).

## 6. Functional requirements
- **`eval_configs`**: judge model, rubric/prompt, `scorers[]`, sampling rate + stratified tiers,
  scope filters (project/feature/tag/model), schedule, enabled.
- **Sampler** (cron): pull recent traces (+ PRD-0 content for RAG) → run configured judges → write
  `eval_scores` (+ extended `scorer_type`) and a Tinybird quality time-series.
- **Alerting** on score drop vs baseline (reuse `lib/alerts/evaluator.ts`).
- **Cost control**: cheap judge (Haiku) default, sampling, and **self-metering via Prism's own
  gateway** (dogfood).

## 7. Data model
- **Supabase `eval_configs`**: `id, org_id, project_id, name, judge_model, rubric, scorers jsonb,
  sampling jsonb {rate, tiers}, scope jsonb, schedule, enabled, created_by`.
- **Extend `eval_scores.scorer_type`** enum: `+ faithfulness, answer_relevancy, context_precision,
  context_recall, toxicity, hallucination, custom_rubric`.
- **Tinybird `eval_score_events` DS**: `org_id, project_id, trace_id, model, feature, scorer_type,
  score, passed, judge_model, cost_usd, ts` → pipes `quality_timeseries`, `quality_by_model`,
  `quality_by_feature`.

## 8. API & SDK surface (TS + Python parity)
- `GET/POST/PUT/DELETE /api/evaluations/configs` (gated by `canWriteOrg`).
- `POST /api/cron/run-online-evals` (cron-triggered sampler).
- Reuse `POST /api/evaluations/scores` for writes.
- SDK mostly unaffected (server-side sampling); optionally allow per-call `evaluate: true` hint.

## 9. UX / dashboard pages
- **Quality dashboard** (new `/dashboard/quality` or extend `observe`): score trends by
  model/feature/scorer, pass-rate, edge-case counts, drill to traces.
- **Eval-config UI** in Settings.
- **Alerts** wired into the existing alerts page.

## 10. Phased task breakdown + acceptance criteria
- **P1.1 Configs** model + API. *AC:* create a config scoped to a project/feature.
- **P1.2 Sampler cron** with stratified sampling. *AC:* cron scores a configurable % of recent traces → `eval_scores`.
- **P1.3 Rubric judge** (reuse `validator.ts`). *AC:* generic quality score + `reason` per sample.
- **P1.4 RAG scorers** (need PRD-0 context). *AC:* faithfulness/answer-relevancy/context-precision/recall computed when context present.
- **P1.5 Safety scorers** (toxicity, hallucination). *AC:* flagged samples appear with explanations.
- **P1.6 Quality pipe + dashboard.** *AC:* trends render by model/feature.
- **P1.7 Alerts.** *AC:* a simulated quality drop fires an alert.

## 11. Dependencies
**PRD-0** (content/context for RAG scorers). Reuses `validator.ts`, `eval_scores`, cron, alerts.
Feeds **PRD-2** (shared scorer library) and **PRD-7** (quality data for Copilot).

## 12. Success metrics / KPIs
% of traffic scored; **judge↔human agreement** (needs PRD-3); MTTD quality regression; judge cost per
1k scored; cost-per-good-response computed for ≥1 feature.

## 13. Risks & open questions
- **Judge reliability/bias** → rubric + calibration + human escalation (PRD-3); store explanations.
- **Judge cost** → sampling + Haiku + self-metering.
- **RAG scorers need context** → hard dependency on PRD-0.
- **Latency** → run async via cron, never inline on the user request path.

## 14. Out of scope (code-analysis doc to follow)
Scorer prompt templates, exact migration + enum SQL, pipe SQL, cron cadence, sampling math — in the
PRD-1 code-analysis doc after approval.
