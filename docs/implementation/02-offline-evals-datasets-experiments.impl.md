# Code-Analysis / Implementation Design — PRD-2: Offline Evals, Datasets & Experiments

> **Implements:** [PRD-2](../prd/02-offline-evals-datasets-experiments.md) · **Phase:** 2 (Dev loop) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #5 ·
> **Depends on:** PRD-1 (scorers), PRD-4 (prompt as subject), PRD-0 (from-traces content).

## 0. How to read this doc
Engineering design behind PRD-2. Datasets, runs, and scores tables **already exist**; this is mostly an
experiment runner + compare UI + a CI helper, reusing the PRD-1 scorers and the `/api/arena/chat`
execution path.

---

## 1. Current-state analysis (corrected by code reading)
### 1.1 Datasets already exist — with inline jsonb samples
- `evaluation_datasets` (`supabase/migrations/20260612180000_analytics_beta.sql:34`):
  `id, org_id, name, description, samples jsonb DEFAULT '[]', created_at`. **Samples are an inline
  jsonb array**, not a separate items table.
- CRUD `app/api/evaluations/datasets/route.ts` — `GET` list (returns `sample_count`), `POST` create
  (`canWriteOrg`); `SampleSchema = { input, expected_output?, tags? }`, ≤500 samples.
- ⇒ **Correction to the product PRD:** there is **no `eval_dataset_items` table**. v1 **reuses inline
  `samples jsonb`** (matches the Supabase-first lock); a separate items table is a Phase-2 option only
  if datasets outgrow the 500-row inline cap.

### 1.2 Runs + scores already exist
- `evaluation_runs` (`:42`): `mode, status, current_model, target_model, dataset_id, n_samples,
  edge_cases, overall_score, cost_usd, rec_id, trace_id, samples jsonb, started_at, completed_at`.
- `eval_scores` (`:61`) — per-sample scores (PRD-1). `GET /api/evaluations` lists runs; the Arena
  `GET /api/evaluations/scores` already **aggregates by model** (`avg_score, pass_rate, efficiency`) —
  the base for compare.

### 1.3 Execution + scoring paths exist
- Runner pattern: `app/api/engine/validate/route.ts` (+ `lib/engine/validator.ts`) — SSE/Redis job.
- Execution: `/api/arena/chat` (multi-provider, captures usage). Scorers: PRD-1 `lib/eval/judges.ts`.
- ⇒ An experiment = iterate dataset samples → run the subject via `/api/arena/chat` → score via PRD-1
  scorers → write `eval_scores` + an `evaluation_runs` row.

---

## 2. Design summary
1. **Extend `evaluation_runs`** (small migration) with experiment metadata.
2. **Experiment runner** (reuse the validate job pattern + arena execution + PRD-1 scorers).
3. **From-traces**: build/append dataset samples from `request_logs` (PRD-0).
4. **Compare**: extend the Arena aggregation to diff 2+ runs (quality + cost), with a baseline/threshold.
5. **CI helper** in the SDK: run a dataset, gate on threshold (non-zero exit on regression).

## 3. Data model & migrations
Migration `supabase/migrations/20260619090000_experiments.sql`:
```sql
ALTER TABLE public.evaluation_runs
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'validation'
        CHECK (kind IN ('validation','experiment')),
  ADD COLUMN IF NOT EXISTS git_sha         text,
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb,        -- {prompt_version?, model, params}
  ADD COLUMN IF NOT EXISTS baseline_run_id uuid REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL;
```
- **No new tables** for v1 (datasets inline, scores reused).
- *(Phase-2 option)* `eval_dataset_items` table if inline jsonb becomes a limit.

## 4. Code changes (file-by-file)
### 4.1 Experiment runner — `app/api/evaluations/experiments/route.ts` (new) + `lib/eval/runner.ts`
- `POST` creates an `evaluation_runs` row (`kind='experiment'`, `config_snapshot`, `git_sha`,
  `baseline_run_id?`), then runs (Redis job like `validate`): for each dataset sample → resolve subject
  (prompt version from PRD-4 / model / params) → `/api/arena/chat` → PRD-1 scorers → `eval_scores`.
  Aggregate `overall_score`, `cost_usd`, `edge_cases` onto the run. `canWriteOrg`.

### 4.2 From-traces — `app/api/evaluations/datasets/from-traces/route.ts` (new)
- Select `request_logs` (PRD-0) by filter → map to `{input, expected_output}` samples → append to a
  dataset's inline `samples` (or create one). `canWriteOrg`.

### 4.3 Compare — extend `GET /api/evaluations/scores`
- Accept `?run_ids=a,b` → return per-run aggregates side by side + deltas vs `baseline_run_id`.

### 4.4 CI helper — SDK (TS + Python)
- `prism.evals.run({ dataset, subject, threshold })` → POST experiment, poll, return
  `{ passed, score, regressions }`; CLI wrapper exits non-zero on failure (for CI gates). Mirror in Py.

## 5. UX
- **Datasets** page (extend the existing datasets list): items editor + **from-traces** action.
- **Experiment compare** (extend `workbench/arena`): side-by-side runs (quality + cost) + diff + a
  **regression vs baseline** badge.

## 6. Phased task breakdown → files (each gated by `tsc`/`build`)
- **P2.1** `evaluation_runs` migration + types. *AC:* experiment fields present.
- **P2.2** Experiment runner + `/experiments` route. *AC:* run a config over a dataset → scores + aggregated run.
- **P2.3** From-traces. *AC:* build a dataset from selected traces.
- **P2.4** Compare endpoint + UI. *AC:* two runs side by side with deltas.
- **P2.5** CI SDK helper. *AC:* CI run fails on a seeded regression vs baseline.

## 7. Locked-decision alignment + small choices
- Inherits PRD-0/1 locks. **Datasets storage — recommend:** keep inline `samples jsonb` for v1
  (reuse existing CRUD); revisit a separate items table only at scale.
- **Runner transport — recommend:** Redis job (reuse the `validate` pattern) for long runs.

## 8. Risks
- **Dataset staleness** → from-traces refresh + ownership.
- **Flaky judges in CI** → deterministic rubric + thresholds + retries (PRD-1 scorers).
- **Long runs** → Redis job + `maxDuration 300`; chunk large datasets.

## 9. Test plan
- **Unit:** experiment aggregation; baseline delta math; `read_only` blocked; from-traces mapping.
- **Integration:** run an experiment over a 10-sample dataset → `eval_scores` + run aggregate; compare
  two runs returns deltas.
- **E2E:** CI helper gates a seeded regression (exit non-zero); from-traces builds a dataset.
- **Gates:** `tsc`/`lint`/`build`; SDK TS `vitest` + Python `pytest`.

---

## 10. Build status & corrections (2026-06-15 — backend COMPLETE)
All five phases are implemented and verified (web `tsc` + `next build` clean; web runner unit tests,
TS `vitest`, Python `pytest` all green).

**Shipped files**
- **P2.1** `supabase/migrations/20260615120000_experiments.sql` — `evaluation_runs` + `kind`, `name`,
  `git_sha`, `config_snapshot`, `baseline_run_id`, `project_id`; index `(org_id, kind, created_at)`.
- **P2.2** `lib/eval/runner.ts` (`runExperiment`) + `app/api/evaluations/experiments/route.ts`
  (`POST` run, `GET` list). Execution via new **`lib/arena/execute.ts`**.
- **P2.3** `app/api/evaluations/datasets/from-traces/route.ts`.
- **P2.4** `GET /api/evaluations/scores?run_ids=a,b` compare branch (per-scorer breakdown + deltas +
  regression flag).
- **P2.5** SDK CI helper: TS `packages/typescript-sdk/src/evals.ts` (`runEval`/`gateEval`/`runEvalCli`,
  `bin: prism-evals`, v0.5.0) + Python `packages/python-sdk/prism/evals.py`
  (`run_eval`/`gate_eval`/`run_eval_cli`, `prism-evals` console script, v0.4.0). Both mirror the same
  `/api/evaluations/experiments` contract.

**Corrections to the original design (and why)**
1. **Execution is in-process, not an HTTP hop to `/api/arena/chat`.** That route is gated by
   `requireAuth()` (a browser session); the runner has **no session** (CI key / background job), so the
   provider-dispatch core was extracted into a session-less `lib/arena/execute.ts` and is called
   directly. Exactly the "extract a shared helper to avoid an HTTP hop" precedent PRD-1 set with
   `recordScores()`.
2. **The runner is synchronous inside the experiment `POST` (samples capped at 50, concurrency 4),**
   not the SSE-driven Redis job the validate flow uses. The primary consumer is a **headless CI gate
   that blocks on the verdict**, and the SSE/Redis pattern is browser-driven. Async/Redis for very large
   datasets is a clean follow-up; `maxDuration=300` covers the capped synchronous path.
3. **`/experiments` accepts dual auth — browser session (`canWriteOrg`) OR a Prism API key**
   (`authenticateIngestKey`). The API-key path is what makes it callable from CI.
4. **Added two offline scorers to `lib/eval/judges.ts`:** `correctness` (graded vs the dataset's gold
   `expected_output`) and deterministic `exact_match` (no judge call → flake-free CI, per §8 risk).
   `ScorerInput` gained an optional `reference`. No migration (`scorer_type` is free text).
5. **Experiment model spend is captured to Tinybird with `environment="experiment"`** so it appears in
   analytics but is filterable out of production views.

**Still pending (out of this backend scope):** all PRD-2 UI (spec'd in `docs/frontend/pending-ui.md`
§3 Phase 2); optional async/Redis runner for >50-sample datasets; wiring `prompt_version` to the PRD-4
prompt registry once it lands (today it's a passthrough label in `config_snapshot`).
