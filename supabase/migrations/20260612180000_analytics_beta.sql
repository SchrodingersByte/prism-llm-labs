-- =============================================================================
-- PRISM (staging) — PHASE 7: ANALYTICS EXTRAS (beta)
--   Trace metadata, the evaluations chain (datasets → runs → scores), GPU
--   inference cost runs, outcome tracking, and the recommendation engine.
--   These are mostly Tinybird-backed at runtime; Supabase holds metadata only.
--   Columns verified against database.types.ts. org_id FK cascades throughout.
-- =============================================================================

-- 0. writer helper: org roles that may write content (EXCLUDES read_only).
--    Closes the gap where is_org_member() let read_only write. Reused below and
--    retro-applied to the Phase-3 request policies at the end of this migration.
CREATE OR REPLACE FUNCTION public.can_write_org(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.org_role_for(p_org_id) IN ('owner','administrator','developer');
$$;

-- 1. traces (root trace metadata; spans live in Tinybird) --------------------
CREATE TABLE public.traces (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  trace_id        text        NOT NULL,
  root_session_id text,
  root_span_id    text,
  status          text        NOT NULL DEFAULT 'ok',
  total_cost_usd  numeric(14,8),
  metadata        jsonb,
  started_at      timestamptz,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, trace_id)
);

-- 2. evaluations: datasets → runs → scores -----------------------------------
CREATE TABLE public.evaluation_datasets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  samples     jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.evaluation_runs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id)        ON DELETE CASCADE,
  dataset_id    uuid        REFERENCES public.evaluation_datasets(id)           ON DELETE SET NULL,
  mode          text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending',
  current_model text,
  target_model  text,
  n_samples     integer,
  edge_cases    integer,
  overall_score numeric,
  cost_usd      numeric(12,4),
  rec_id        text,
  trace_id      text,
  samples       jsonb,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.eval_scores (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  eval_run_id uuid        REFERENCES public.evaluation_runs(id)         ON DELETE CASCADE,
  scorer_type text        NOT NULL DEFAULT 'judge',
  model       text,
  judge_model text,
  score       numeric,
  passed      boolean,
  reason      text,
  cost_usd    numeric(12,6),
  latency_ms  integer,
  trace_id    text,
  span_id     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 3. gpu_inference_runs (self-hosted GPU endpoint cost) ----------------------
CREATE TABLE public.gpu_inference_runs (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id       uuid          REFERENCES public.api_keys(id)               ON DELETE SET NULL,
  provider         text          NOT NULL,
  endpoint_name    text          NOT NULL,
  instance_type    text,
  cost_usd         numeric(14,8) NOT NULL,
  duration_seconds numeric,
  requests         bigint,
  session_id       text,
  tags             jsonb,
  start_time       timestamptz,
  end_time         timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- 4. outcome tracking (events + automation rules) ----------------------------
CREATE TABLE public.outcome_events (
  id          uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  api_key_id  uuid          REFERENCES public.api_keys(id)               ON DELETE SET NULL,
  feature_tag text          NOT NULL,
  action_tag  text,
  success     boolean       NOT NULL DEFAULT true,
  value_usd   numeric(14,8),
  session_id  text,
  metadata    jsonb,
  occurred_at timestamptz   NOT NULL DEFAULT now(),
  created_at  timestamptz   NOT NULL DEFAULT now()
);
CREATE TABLE public.outcome_rules (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_source text        NOT NULL CHECK (event_source IN (
    'github_pr_merge','github_deployment_success','stripe_payment','generic_webhook','mcp_session_success')),
  feature_tag  text        NOT NULL,
  action_tag   text,
  value_usd    numeric(14,8),
  success      boolean     NOT NULL DEFAULT true,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 5. recommendation engine (actions + AI narratives) -------------------------
CREATE TABLE public.recommendation_actions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rec_id            text        NOT NULL,
  rec_type          text        NOT NULL,
  title             text,
  feature           text,
  current_model     text,
  suggested_model   text,
  status            text        NOT NULL DEFAULT 'pending',
  validation_score  numeric,
  validation_result jsonb,
  staged_at         timestamptz,
  applied_at        timestamptz,
  applied_by        uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  rejected_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.recommendation_narratives (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rec_key      text        NOT NULL,
  narrative    text        NOT NULL,
  stats_hash   text,
  generated_at timestamptz NOT NULL DEFAULT now()
);

-- 6. INDEXES ----------------------------------------------------------------
CREATE INDEX idx_traces_org            ON public.traces(org_id, created_at DESC);
CREATE INDEX idx_eval_datasets_org     ON public.evaluation_datasets(org_id);
CREATE INDEX idx_eval_runs_org         ON public.evaluation_runs(org_id, created_at DESC);
CREATE INDEX idx_eval_scores_run       ON public.eval_scores(eval_run_id);
CREATE INDEX idx_gpu_runs_org          ON public.gpu_inference_runs(org_id, created_at DESC);
CREATE INDEX idx_outcome_events_org    ON public.outcome_events(org_id, occurred_at DESC);
CREATE INDEX idx_outcome_rules_org     ON public.outcome_rules(org_id, event_source) WHERE is_active;
CREATE INDEX idx_rec_actions_org       ON public.recommendation_actions(org_id, status);
CREATE INDEX idx_rec_narratives_org    ON public.recommendation_narratives(org_id, rec_key);

-- 7. updated_at TRIGGERS -----------------------------------------------------
CREATE TRIGGER recommendation_actions_updated_at BEFORE UPDATE ON public.recommendation_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. ROW LEVEL SECURITY ------------------------------------------------------
ALTER TABLE public.traces                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_datasets       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluation_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eval_scores               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gpu_inference_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outcome_rules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_actions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_narratives ENABLE ROW LEVEL SECURITY;

-- service-written analytics: members read only
CREATE POLICY traces_select     ON public.traces                    FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY eval_scores_select ON public.eval_scores              FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY gpu_select        ON public.gpu_inference_runs        FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY oe_select         ON public.outcome_events            FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY rn_select         ON public.recommendation_narratives FOR SELECT USING (public.is_org_member(org_id));

-- user-managed eval workflows: members read + write
CREATE POLICY ed_select ON public.evaluation_datasets FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ed_write  ON public.evaluation_datasets FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE POLICY er_select ON public.evaluation_runs FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY er_write  ON public.evaluation_runs FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));

-- recommendation actions (stage/apply): members read; admins act
CREATE POLICY ra_select ON public.recommendation_actions FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ra_write  ON public.recommendation_actions FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- outcome rules (config): members read; admins manage
CREATE POLICY or_select ON public.outcome_rules FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY or_write  ON public.outcome_rules FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- 9. RETROFIT Phase-3 request policies: read_only must not file requests ------
DROP POLICY IF EXISTS mar_insert ON public.model_approval_requests;
CREATE POLICY mar_insert ON public.model_approval_requests FOR INSERT
  WITH CHECK (public.can_write_org(org_id) AND requested_by = auth.uid());
DROP POLICY IF EXISTS ker_insert ON public.key_extension_requests;
CREATE POLICY ker_insert ON public.key_extension_requests FOR INSERT
  WITH CHECK (public.can_write_org(org_id) AND requester_id = auth.uid());
