-- =============================================================================
-- PRISM (staging) — PRD-2: Offline Evals, Datasets & Experiments (Phase 2)
--   Extends the existing evaluation_runs table (datasets → runs → scores already
--   exist, see 20260612180000_analytics_beta.sql) with experiment metadata so a
--   run can record WHAT was tested (config_snapshot: model/prompt/params), the
--   git commit it was tied to (git_sha — Braintrust-style CI provenance), and a
--   baseline to diff against (baseline_run_id) for regression gating.
--
--   No new tables: v1 datasets stay inline (evaluation_datasets.samples jsonb),
--   scores stay in eval_scores (scorer_type is free text). A separate
--   eval_dataset_items table is a scale-only follow-up.
--   Design: docs/implementation/02-offline-evals-datasets-experiments.impl.md
-- =============================================================================

ALTER TABLE public.evaluation_runs
  -- 'validation' = the engine model-swap A/B runs that already exist;
  -- 'experiment' = a PRD-2 offline run of one config over a dataset.
  ADD COLUMN IF NOT EXISTS kind            text NOT NULL DEFAULT 'validation'
        CHECK (kind IN ('validation','experiment')),
  -- Human label for the experiment (shown in the compare UI). Null for legacy/validation runs.
  ADD COLUMN IF NOT EXISTS name            text,
  -- Git provenance so a CI run can be traced back to the commit under test.
  ADD COLUMN IF NOT EXISTS git_sha         text,
  -- The subject under test: { model, system_prompt?, prompt_version?, params?, scorers, judge_model }.
  ADD COLUMN IF NOT EXISTS config_snapshot jsonb,
  -- The run this experiment is compared against for regression gating.
  ADD COLUMN IF NOT EXISTS baseline_run_id uuid REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
  -- Project attribution (datasets/scores are org-scoped; experiments can be project-scoped).
  ADD COLUMN IF NOT EXISTS project_id      uuid REFERENCES public.projects(id) ON DELETE SET NULL;

-- List/compare experiments for an org quickly (the experiments tab + compare endpoint).
CREATE INDEX IF NOT EXISTS idx_evaluation_runs_org_kind
  ON public.evaluation_runs(org_id, kind, created_at DESC);
