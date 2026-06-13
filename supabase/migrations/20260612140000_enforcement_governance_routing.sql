-- =============================================================================
-- PRISM (staging) — PHASE 3: ENFORCEMENT / GOVERNANCE / ROUTING
--   Org gateway control-plane columns (cache + PII + semantic-cache thresholds)
--   + unified enforcement_policies, model governance (org_model_policies +
--   model_approval_requests), routing (model_routing_rules + routing_policies),
--   guardrails (profiles + rules), and key_extension_requests.
--   Table DDL copied from the dev canonical migrations; RLS upgraded to the
--   Phase-1 4-role helpers.
-- =============================================================================

-- 1. organizations: cache + PII + semantic-cache controls ---------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS cache_enabled     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cache_ttl_seconds int     NOT NULL DEFAULT 3600,
  ADD COLUMN IF NOT EXISTS cache_mode        text    NOT NULL DEFAULT 'exact'
    CHECK (cache_mode IN ('exact','semantic')),
  ADD COLUMN IF NOT EXISTS cache_conversation_history_threshold int NOT NULL DEFAULT 0
    CHECK (cache_conversation_history_threshold BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS similarity_threshold numeric(3,2) NOT NULL DEFAULT 0.92
    CHECK (similarity_threshold BETWEEN 0.7 AND 1.0),
  ADD COLUMN IF NOT EXISTS pii_masking_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pii_mask_patterns   text[]  NOT NULL
    DEFAULT ARRAY['email','phone','ssn','credit_card','ip_address'],
  ADD COLUMN IF NOT EXISTS pii_detection_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pii_detection_action  text    NOT NULL DEFAULT 'warn'
    CHECK (pii_detection_action IN ('warn','block')),
  ADD COLUMN IF NOT EXISTS pii_custom_patterns   jsonb;

-- 2. enforcement_policies (unified org/project policy) -----------------------
CREATE TABLE public.enforcement_policies (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     text        NOT NULL,
  scope_type               text        NOT NULL CHECK (scope_type IN ('org', 'project')),
  scope_id                 uuid        NOT NULL,
  UNIQUE (scope_type, scope_id),
  requests_per_minute      integer,
  tokens_per_day           bigint,
  monthly_budget_usd       numeric(12,4),
  daily_budget_usd         numeric(12,4),
  soft_cap_pct             integer     CHECK (soft_cap_pct BETWEEN 1 AND 100),
  soft_cap_fallback_model  text,
  gateway_required         boolean     NOT NULL DEFAULT false,
  data_residency_region    text        CHECK (data_residency_region IN ('us', 'eu', 'apac')),
  model_policy             text        NOT NULL DEFAULT 'open'
                                       CHECK (model_policy IN ('open', 'allowlist', 'blocklist', 'requires_approval')),
  allowed_models           text[]      NOT NULL DEFAULT '{}',
  blocked_models           text[]      NOT NULL DEFAULT '{}',
  pii_detection_enabled    boolean     NOT NULL DEFAULT false,
  pii_action               text        NOT NULL DEFAULT 'mask'
                                       CHECK (pii_action IN ('mask', 'block', 'log_only')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- 3. model_approval_requests (approval workflow) -----------------------------
CREATE TABLE public.model_approval_requests (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id             uuid        REFERENCES public.projects(id)              ON DELETE CASCADE,
  enforcement_policy_id  uuid        REFERENCES public.enforcement_policies(id)  ON DELETE SET NULL,
  model                  text        NOT NULL,
  provider               text        NOT NULL,
  requested_by           uuid        NOT NULL REFERENCES auth.users(id)          ON DELETE CASCADE,
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by            uuid        REFERENCES auth.users(id)                   ON DELETE SET NULL,
  reviewed_at            timestamptz,
  reason                 text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- 4. model_routing_rules (failure-triggered fallback chains) -----------------
CREATE TABLE public.model_routing_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  primary_model     text NOT NULL,
  fallback_models   text[] NOT NULL DEFAULT '{}',
  trigger_on_codes  integer[] NOT NULL DEFAULT '{429,503}',
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (org_id, primary_model)
);

-- 5. routing_policies (proactive, condition-driven routing) ------------------
CREATE TABLE public.routing_policies (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  priority    int         NOT NULL DEFAULT 100,
  condition   jsonb       NOT NULL,
  action      jsonb       NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 6. org_model_policies (allow/block/requires_approval per model pattern) -----
CREATE TABLE public.org_model_policies (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  model_pattern  text        NOT NULL,
  environments   text[],
  policy         text        NOT NULL CHECK (policy IN ('allowed','blocked','requires_approval')),
  created_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, model_pattern, environments)
);

-- 7. guardrail_profiles + guardrail_rules (content safety) -------------------
CREATE TABLE public.guardrail_profiles (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  type            text        NOT NULL DEFAULT 'builtin_pii'
                              CHECK (type IN ('builtin_pii', 'bedrock', 'azure')),
  pii_types       text[],
  custom_patterns jsonb       NOT NULL DEFAULT '[]'::jsonb,
  config          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.guardrail_rules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id)      ON DELETE CASCADE,
  profile_id    uuid        NOT NULL REFERENCES public.guardrail_profiles(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  priority      int         NOT NULL DEFAULT 100,
  apply_to      text        NOT NULL DEFAULT 'both' CHECK (apply_to IN ('input', 'output', 'both')),
  action        text        NOT NULL CHECK (action IN ('warn', 'block', 'redact')),
  condition     jsonb,
  sampling_rate real        NOT NULL DEFAULT 1 CHECK (sampling_rate >= 0 AND sampling_rate <= 1),
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 8. key_extension_requests (cap/expiry increase workflow) -------------------
CREATE TABLE public.key_extension_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  requester_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_type    text NOT NULL
    CHECK (request_type IN ('expire_extension','cost_increase','daily_cap_increase','usage_buffer','renewal')),
  current_value   text,
  requested_value text,
  reason          text,
  urgency         text DEFAULT 'medium' CHECK (urgency IN ('low','medium','high')),
  status          text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto_applied')),
  approved_by     uuid REFERENCES auth.users(id),
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 9. INDEXES -----------------------------------------------------------------
CREATE INDEX idx_enforcement_scope     ON public.enforcement_policies(scope_type, scope_id);
CREATE INDEX idx_model_approvals_org   ON public.model_approval_requests(org_id, status);
CREATE INDEX idx_routing_org_model     ON public.model_routing_rules(org_id, primary_model) WHERE is_active = true;
CREATE INDEX idx_routing_policies_org  ON public.routing_policies(org_id, is_active, priority);
CREATE INDEX idx_org_model_policies    ON public.org_model_policies(org_id);
CREATE INDEX idx_guardrail_profiles_org ON public.guardrail_profiles(org_id);
CREATE INDEX idx_guardrail_rules_org   ON public.guardrail_rules(org_id, is_active, priority);
CREATE INDEX idx_key_ext_req_org       ON public.key_extension_requests(org_id, status);

-- 10. updated_at TRIGGERS ----------------------------------------------------
CREATE TRIGGER enforcement_policies_updated_at BEFORE UPDATE ON public.enforcement_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER routing_policies_updated_at BEFORE UPDATE ON public.routing_policies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER guardrail_profiles_updated_at BEFORE UPDATE ON public.guardrail_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER guardrail_rules_updated_at BEFORE UPDATE ON public.guardrail_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 11. ROW LEVEL SECURITY (reuses Phase-1 helpers) ----------------------------
ALTER TABLE public.enforcement_policies     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_approval_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.model_routing_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_policies         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_model_policies       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardrail_profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guardrail_rules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_extension_requests   ENABLE ROW LEVEL SECURITY;

-- enforcement_policies: scope-aware (org admin OR project manager writes)
CREATE POLICY ep_select ON public.enforcement_policies FOR SELECT USING (
  (scope_type = 'org'     AND public.is_org_member(scope_id))
  OR (scope_type = 'project' AND public.can_read_project(scope_id)));
CREATE POLICY ep_write ON public.enforcement_policies FOR ALL
  USING (
    (scope_type = 'org'     AND public.is_org_admin(scope_id))
    OR (scope_type = 'project' AND public.can_manage_project(scope_id)))
  WITH CHECK (
    (scope_type = 'org'     AND public.is_org_admin(scope_id))
    OR (scope_type = 'project' AND public.can_manage_project(scope_id)));

-- config/governance tables: members read, org admins write
CREATE POLICY mrr_select ON public.model_routing_rules FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY mrr_write  ON public.model_routing_rules FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY rp_select  ON public.routing_policies   FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY rp_write   ON public.routing_policies   FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY omp_select ON public.org_model_policies FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY omp_write  ON public.org_model_policies FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY gp_select  ON public.guardrail_profiles FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY gp_write   ON public.guardrail_profiles FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY gr_select  ON public.guardrail_rules    FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY gr_write   ON public.guardrail_rules    FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- request workflows: any member can read + file a request for themselves; admins resolve
CREATE POLICY mar_select ON public.model_approval_requests FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY mar_insert ON public.model_approval_requests FOR INSERT
  WITH CHECK (public.is_org_member(org_id) AND requested_by = auth.uid());
CREATE POLICY mar_resolve ON public.model_approval_requests FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY mar_delete  ON public.model_approval_requests FOR DELETE USING (public.is_org_admin(org_id));

CREATE POLICY ker_select ON public.key_extension_requests FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ker_insert ON public.key_extension_requests FOR INSERT
  WITH CHECK (public.is_org_member(org_id) AND requester_id = auth.uid());
CREATE POLICY ker_resolve ON public.key_extension_requests FOR UPDATE USING (public.is_org_admin(org_id));
CREATE POLICY ker_delete  ON public.key_extension_requests FOR DELETE USING (public.is_org_admin(org_id));
