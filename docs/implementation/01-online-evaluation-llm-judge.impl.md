# Code-Analysis / Implementation Design — PRD-1: Online Evaluation & LLM-as-Judge

> **Implements:** [PRD-1](../prd/01-online-evaluation-llm-judge.md) · **Phase:** 1 (Quality core) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #2 ·
> **Depends on:** [PRD-0](00-content-embedding-capture.impl.md) (RAG context); generic + safety
> scorers work on gateway-mode `request_logs` content that already exists.

## 0. How to read this doc
Engineering design behind PRD-1: verified current state, the (minimal) data model, file-by-file
changes, the sampler/cron design, judge-through-gateway, and open decisions. **Headline: most of this
is wiring existing parts together, not new infrastructure.**

---

## 1. Current-state analysis (corrected by code reading)
### 1.1 There is already a judge — but it's pairwise
- `apps/web/lib/engine/validator.ts` → `judgeResponses(question, responseA, responseB)` (`:19`) scores
  **A-vs-B semantic agreement** with Claude Haiku (`claude-haiku-4-5`, `:14`) via a **direct**
  `api.anthropic.com` call using `process.env.ANTHROPIC_API_KEY` (`:24`). Returns `{score, reason}`,
  `is_edge = score < 0.7`.
- ⇒ For online eval we need a **single-output rubric judge** (score one completion against a
  rubric / against retrieved context), which does **not** exist yet. The pairwise judge stays for
  PRD-2 model comparison.

### 1.2 There is already a production-traffic sampler — for validation
- `runRealSampleValidation()` (`validator.ts:234`) **already pulls recent `request_logs` by model**
  (`:248-258`: `prompt, completion`, last 7 days, `limit n*3`, random sample). Online eval reuses this
  exact query pattern — but **scores the stored `completion` directly** (no model re-run needed for
  pure scoring), which is far cheaper.

### 1.3 Job + cron patterns are established
- **Validate route** `app/api/engine/validate/route.ts`: `requireAuth` + `checkFeature(orgId,
  "engine")` + `maxDuration 300`; synthetic = SSE stream, real = Upstash Redis job
  (`validation:${jobId}`, 1h TTL).
- **Cron** `app/api/cron/build-recommendations/route.ts`: `Authorization: Bearer <CRON_SECRET>` guard
  (`:24-27`), iterate `organizations` (`:30`), per-org try/catch, `maxDuration 300`, Vercel Cron via
  `vercel.json`. ⇒ The online-eval **sampler is a new cron in this shape**.

### 1.4 The score store needs almost no change
- `eval_scores` (`supabase/migrations/20260612180000_analytics_beta.sql:61`):
  `scorer_type text NOT NULL DEFAULT 'judge'` — **no CHECK constraint** (free text). `judge_model`,
  `score numeric`, `passed`, `reason`, `cost_usd numeric(12,6)`, `latency_ms`, `trace_id`, `span_id`,
  `eval_run_id`. **⇒ Adding `faithfulness`/`answer_relevancy`/`context_precision`/`context_recall`/
  `toxicity`/`hallucination` needs NO migration — just the scorer code + the zod enum.**
- RLS: `eval_scores_select` = `is_org_member` (`:180`); writes are service-role (the `/api/evaluations/
  scores` POST uses `createAdminClient` behind a `canWriteOrg` gate).
- `evaluation_runs` (`:42`) + `evaluation_datasets` already exist (PRD-2 reuses them).

### 1.5 Cost-per-good-response is reachable now
`outcome_events` (`tinybird/datasources/outcome_events.datasource`: `feature_tag, success,
value_usd, session_id`) + `eval_scores` (quality) + `llm_events` (cost) → the fused metric. No new
ingest needed.

---

## 2. Design summary
1. **New single-output judge** (`lib/eval/judges.ts`) with pluggable scorers: `rubric`, RAGAS
   (`faithfulness`, `answer_relevancy`, `context_precision`, `context_recall`), `toxicity`,
   `hallucination`. Each returns `{score, passed, reason}`.
2. **Route judges through Prism's own gateway** (not direct Anthropic) for self-metering + cost
   control — cheap Haiku default.
3. **`eval_configs`** table (the only new table) + a **sampler cron** that reads `request_logs`
   (PRD-0 content), applies stratified sampling, runs the configured scorers, writes `eval_scores`.
4. **Quality trends**: mirror each score to a Tinybird `eval_score_events` DS at write time → trend
   pipes (consistent with the analytics layer); Supabase stays the source of truth.
5. **Alerts**: add a `quality_drop` type to the existing alerts evaluator.

---

## 3. Data model & migrations
Migration `supabase/migrations/20260616090000_eval_configs.sql`:
```sql
CREATE TABLE public.eval_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,   -- null = all projects
  name        text NOT NULL,
  judge_model text NOT NULL DEFAULT 'claude-haiku-4-5',
  rubric      text,                          -- instruction for the rubric scorer
  scorers     jsonb NOT NULL DEFAULT '["rubric"]',   -- subset of the scorer registry
  sampling    jsonb NOT NULL DEFAULT '{"rate":0.05,"tiers":{}}',  -- rate + stratified tiers
  scope       jsonb NOT NULL DEFAULT '{}',   -- {model?, feature?, tag?}
  enabled     boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.eval_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY ec_select ON public.eval_configs FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ec_write  ON public.eval_configs FOR ALL
  USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE INDEX idx_eval_configs_org ON public.eval_configs(org_id) WHERE enabled;
CREATE TRIGGER eval_configs_updated_at BEFORE UPDATE ON public.eval_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```
- **No `eval_scores` migration** (scorer_type is free text). Optionally tighten the zod enum only.
- **Tinybird** (new) `tinybird/datasources/eval_score_events.datasource` + pipes
  `quality_timeseries.pipe`, `quality_by_model.pipe`, `quality_by_feature.pipe` (see §7 open decision).

---

## 4. Code changes (file-by-file)
### 4.1 Scorer library — `apps/web/lib/eval/judges.ts` (new)
- `scoreRubric(output, rubric, judgeModel)`, `scoreFaithfulness(output, context)`,
  `scoreAnswerRelevancy(question, output)`, `scoreContextPrecision/Recall(question, context, output)`,
  `scoreToxicity(output)`, `scoreHallucination(output, context)`.
- Each calls the judge model **via the gateway** (see 4.2). Returns `{score, passed, reason,
  cost_usd, latency_ms}`. Reuse the JSON-reply prompt style from `judgeResponses` (`validator.ts:27`).

### 4.2 Judge transport — reuse the gateway (`lib/eval/judge-client.ts`)
- Instead of direct `api.anthropic.com` (as `validator.ts:39` does), call
  `${APP_URL}/api/gateway/anthropic/...` with an internal Prism key so judge spend is **metered by
  Prism itself** and obeys caps. Keep a direct-Anthropic fallback when no internal key is configured
  (mirrors `validator.ts`'s `ANTHROPIC_API_KEY` fallback).

### 4.3 Sampler cron — `apps/web/app/api/cron/run-online-evals/route.ts` (new)
- Copy the `build-recommendations` shape: `CRON_SECRET` guard, iterate orgs (or `eval_configs`),
  `maxDuration 300`.
- For each enabled config: query recent `request_logs` (reuse the `validator.ts:248` pattern) filtered
  by `scope`; apply **stratified sampling** (`sampling.tiers` → common/long-tail/adversarial/
  catastrophic; default uniform at `sampling.rate`); run the config's scorers; write rows via the
  shared scores writer (4.4); mirror to Tinybird (4.5).

### 4.4 Scores writer — reuse `POST /api/evaluations/scores`
- Already inserts into `eval_scores` (admin client, `canWriteOrg`). Extend its zod `scorer_type` enum
  to include the new scorers; the sampler calls a shared `recordScores()` helper (extracted from the
  route) to avoid an HTTP hop.

### 4.5 Quality trends — `lib/tinybird/client.ts`
- On score write, also `ingestToTinybird(rows, "eval_score_events")` (the function already takes a
  datasource arg, `client.ts:56`). Dashboard reads `queryTinybird("quality_timeseries", …)`.

### 4.6 Config API — `apps/web/app/api/evaluations/configs/route.ts` (new)
- `GET/POST/PUT/DELETE`, gated by `canWriteOrg` for writes (same pattern as `/api/evaluations`).

### 4.7 Alerts — `apps/web/lib/alerts/evaluator.ts`
- Add a `quality_drop` alert type: compares recent `quality_timeseries` vs a baseline window; fires via
  the existing alert delivery path.

### 4.8 Cost-per-good-response — `apps/web/lib/metrics/` (new pipe consumer)
- A pipe/query joining `eval_score_events` (passed) × `llm_events` (cost) × `outcome_events` to
  expose cost-per-good-response per feature (surfaced in Unit Economics + PRD-7 Copilot).

---

## 5. UX
- **Quality dashboard** (new `app/dashboard/quality/page.tsx` or extend `observe`): score trend by
  model/feature/scorer, pass-rate, edge-case list (drill to trace via `trace_id`/`span_id`).
- **Eval-config UI** in Settings (create/scope/scorers/sampling).
- **Alerts**: `quality_drop` appears in the existing alerts page.

## 6. Phased tasks → files (each gated by `tsc`/`build`)
- **P1.1** `eval_configs` migration + types + `configs` CRUD route. *AC:* config CRUD; `read_only` blocked.
- **P1.2** Scorer library + gateway judge transport. *AC:* rubric scorer returns score+reason; judge spend metered by Prism.
- **P1.3** Sampler cron + stratified sampling + shared `recordScores()`. *AC:* cron scores a % of recent `request_logs` → `eval_scores`.
- **P1.4** RAGAS scorers (need PRD-0 `context`). *AC:* faithfulness/relevancy/precision/recall computed when context present.
- **P1.5** Safety scorers (toxicity, hallucination). *AC:* flagged samples with explanations.
- **P1.6** Tinybird `eval_score_events` + quality pipes + dashboard. *AC:* trends render.
- **P1.7** `quality_drop` alert. *AC:* simulated drop fires an alert.

## 7. Locked decisions (confirmed 2026-06-14)
1. **Quality trend storage — LOCKED: mirror scores to Tinybird `eval_score_events`;** Supabase
   `eval_scores` stays the source of truth.
2. **Judge transport — LOCKED: route judges through Prism's own gateway (self-metering),** with a
   direct-Anthropic fallback when no internal key is configured.
3. **Default sampling — LOCKED: 5% with stratified edge/adversarial oversampling** (per-config
   overridable via `eval_configs.sampling`).
4. **Feature gating — LOCKED: reuse `checkFeature("engine")` for v1.**

## 8. Risks
- **Judge cost** → sampling + Haiku + gateway caps (self-metered).
- **Judge reliability/bias** → rubric + store `reason`; human calibration arrives with PRD-3
  (`scorer_type='human'` already supported).
- **RAG scorers depend on PRD-0** → ship rubric + safety first (work on existing gateway content),
  RAGAS after PRD-0 `context` lands.
- **Latency** → cron/async only; never inline on the request path.

## 9. Test plan
- **Unit:** each scorer (golden input → expected score band); stratified sampler selection;
  `scorer_type` enum accepts new values; `read_only` blocked on `configs` write.
- **Integration:** seed `request_logs` → run sampler → `eval_scores` rows + `eval_score_events`
  mirrored; `quality_drop` alert fires on a seeded regression.
- **E2E:** create a config scoped to a feature → cron → quality dashboard shows the trend; judge
  spend appears in Prism's own usage (dogfood).
- **Gates:** `tsc`/`lint`/`build` clean; SDK unaffected.
