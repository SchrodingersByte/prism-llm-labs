-- =============================================================================
-- PRISM (staging) — PRD-1: Online Evaluation & LLM-as-Judge (Phase 1)
--   eval_configs drives the continuous sampler: which judge model + rubric,
--   which scorers, sampling rate/tiers, and the scope (project/feature/model)
--   to score. Scores land in the existing eval_scores table (scorer_type is
--   free text → new scorers need no migration). Design:
--   docs/implementation/01-online-evaluation-llm-judge.impl.md
-- =============================================================================

CREATE TABLE public.eval_configs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES public.projects(id) ON DELETE CASCADE,  -- null = all projects
  name        text        NOT NULL,
  judge_model text        NOT NULL DEFAULT 'claude-haiku-4-5',
  rubric      text,                                              -- instruction for the rubric scorer
  scorers     jsonb       NOT NULL DEFAULT '["rubric"]'::jsonb,  -- subset of the scorer registry
  sampling    jsonb       NOT NULL DEFAULT '{"rate":0.05,"tiers":{}}'::jsonb,
  scope       jsonb       NOT NULL DEFAULT '{}'::jsonb,          -- {model?, feature?, tag?}
  enabled     boolean     NOT NULL DEFAULT true,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_eval_configs_org ON public.eval_configs(org_id) WHERE enabled;

ALTER TABLE public.eval_configs ENABLE ROW LEVEL SECURITY;
-- read: any org member; write: org-scoped owner/administrator/developer (canWriteOrg), not read_only
CREATE POLICY ec_select ON public.eval_configs FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ec_write  ON public.eval_configs FOR ALL
  USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));

CREATE TRIGGER eval_configs_updated_at BEFORE UPDATE ON public.eval_configs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
