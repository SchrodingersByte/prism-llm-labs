# PRD-2 — Offline Evals, Datasets & Experiments

> **Phase:** 2 (Dev loop) · **Status:** Draft for review · **Depends on:** PRD-1 (scorers),
> PRD-4 (prompts as subject), PRD-0 (build-from-traces) ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism has `evaluation_runs` + datasets + scores + the Arena aggregation, but **no first-class dataset
management, no build-dataset-from-traces, no experiment comparison/regression, and no CI gates**.
This is the **dev-time** quality loop (pre-release) that complements PRD-1's production loop. It lets
teams prove a prompt/model/config change is better *before* shipping — the workflow Braintrust and
LangSmith are built around.

## 2. Current state (code anchors)
- `evaluation_runs` — `rec_id, dataset_id, trace_id, mode (synthetic|real), status, overall_score,
  n_samples, edge_cases, current_model, target_model, cost_usd`.
- `GET/POST /api/evaluations`; `/api/evaluations/datasets`; `/api/evaluations/scores` (Arena `GET`
  aggregates `model, avg_score, pass_rate, efficiency`).
- Runner: `/api/engine/validate` + `lib/engine/validator.ts`. Arena UI: `dashboard/workbench/arena`.

## 3. Competitive context
Braintrust centers on experiments with **git metadata**, side-by-side compare, regression testing,
watch mode, and the AutoEvals scorer library; LangSmith builds **datasets from traces** + side-by-side
experiment compare; Datadog ships dataset versioning + experiments from production traces. Best
practice: version datasets; run **paired offline comparisons before release**; stratify regression
tiers.
*Sources: [Braintrust evals for CI/CD](https://www.braintrust.dev/articles/best-ai-evals-tools-cicd-2025), [LangSmith](https://www.langchain.com/langsmith-platform), [offline eval framework](https://towardsdatascience.com/production-ready-llm-agents-a-comprehensive-framework-for-offline-evaluation/).*

## 4. Goals / Non-goals
**Goals:** dataset CRUD + build-from-traces; experiment runs over datasets (prompt/model/config);
side-by-side compare; regression vs baseline; CI gate via SDK/API. **Non-goals:** online sampling
(PRD-1), prompt registry internals (PRD-4, integrates), feedback capture (PRD-3, feeds datasets).

## 5. Division value
- **Data Science / Engineering** — regression-proof releases + CI gates.
- **Product** — prompt/model A/B with quality + cost side by side.
- **Finance** — cost/quality tradeoff visible per experiment before rollout.

## 6. Functional requirements
- **Datasets**: name + items (`input` + `expected`/`reference`), plus a **from-traces** selector
  (pick production traces → dataset items, using PRD-0 content).
- **Experiment**: a run config (prompt version, model, params) executed over a dataset → scores
  (reuse PRD-1 scorer library).
- **Compare** two+ experiments; **baseline ref** + regression threshold.
- **CI helper** returns pass/fail (non-zero exit on regression).

## 7. Data model
- **Supabase `eval_datasets`**: `id, org_id, project_id, name, description, created_by`.
- **Supabase `eval_dataset_items`**: `dataset_id, input jsonb, expected jsonb, metadata jsonb`.
- **Extend `evaluation_runs`**: `+ kind (experiment|validation), git_sha, config_snapshot jsonb,
  baseline_run_id`.
- Scores remain in `eval_scores` (linked via `eval_run_id`).

## 8. API & SDK surface (TS + Python parity)
- `GET/POST/PUT/DELETE /api/evaluations/datasets` + `POST .../datasets/from-traces`.
- `POST /api/evaluations` extended for experiment runs; `GET` for compare.
- **SDK eval runner** (run a dataset locally / in CI) + **threshold gate** helper.

## 9. UX / dashboard pages
- **Datasets** page (list, items editor, from-traces).
- **Experiment compare** (extend the Arena scatter → side-by-side table + diff + cost/quality).
- **Regression view** (vs baseline).

## 10. Phased task breakdown + acceptance criteria
- **P2.1 Dataset model + from-traces.** *AC:* create a dataset; populate it from selected traces.
- **P2.2 Experiment runner.** *AC:* run a config over a dataset → scores recorded.
- **P2.3 Compare UI.** *AC:* two experiments shown side by side with quality + cost deltas.
- **P2.4 CI SDK.** *AC:* a CI run fails on a seeded regression.
- **P2.5 Baseline/regression gating.** *AC:* baseline set; threshold breach flagged.

## 11. Dependencies
**PRD-1** (shared scorer library), **PRD-4** (prompts as experiment subject), **PRD-0** (from-traces
content). Consumes feedback-derived datasets from **PRD-3**.

## 12. Success metrics / KPIs
Datasets created; experiments run; **regressions caught pre-release**; % of releases gated by an eval.

## 13. Risks & open questions
- **Dataset staleness** → refresh-from-traces + ownership.
- **Flaky judges in CI** → deterministic rubric + thresholds + retries.
- **Compute cost** → sampling + cheap judges.

## 14. Out of scope (code-analysis doc to follow)
Migration SQL, SDK CI-helper API shape, compare-UI component spec — in the PRD-2 code-analysis doc.
