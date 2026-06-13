-- =============================================================================
-- PRISM (staging) — PHASE 4: FINANCE & BILLING
--   Corrects organizations.plan tiers to the real set (lib/billing/plans.ts:
--   free|pro|team|enterprise) + billing columns; adds the budget hierarchy,
--   cost-attribution, reconciliation, training, reporting, and multi-tenant
--   quota tables. Columns verified against apps/web/lib/supabase/database.types.ts.
-- =============================================================================

-- 1. organizations: correct plan tiers + billing columns ---------------------
UPDATE public.organizations SET plan = 'free' WHERE plan NOT IN ('free','pro','team','enterprise');
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_plan_check;
ALTER TABLE public.organizations ALTER COLUMN plan SET DEFAULT 'free';
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_plan_check CHECK (plan IN ('free','pro','team','enterprise'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active'
    CHECK (subscription_status IN ('trialing','active','past_due','canceled')),
  ADD COLUMN IF NOT EXISTS stripe_customer_id       text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id   text,
  ADD COLUMN IF NOT EXISTS billing_region text NOT NULL DEFAULT 'US' CHECK (billing_region IN ('US','IN')),
  ADD COLUMN IF NOT EXISTS razorpay_customer_id     text,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id text;

-- 2. projects: cost attribution + project budget fallback --------------------
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS cost_center_code    text,
  ADD COLUMN IF NOT EXISTS monthly_budget_usd  numeric;

-- 3. budgets (hierarchy: org/project/user/provider scope) --------------------
CREATE TABLE public.budgets (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id           uuid          REFERENCES public.projects(id)               ON DELETE CASCADE,
  name                 text,
  period               text          NOT NULL CHECK (period IN ('monthly','quarterly','annual')),
  amount_usd           numeric(12,4) NOT NULL,
  alert_threshold_pct  integer       NOT NULL DEFAULT 80 CHECK (alert_threshold_pct BETWEEN 1 AND 100),
  is_active            boolean       NOT NULL DEFAULT true,
  enforce_hard_cap     boolean       NOT NULL DEFAULT false,
  user_id              uuid,          -- no FK (matches dev): a per-user budget scope tag
  provider             text,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  updated_at           timestamptz   NOT NULL DEFAULT now()
);
-- One budget per (org, project, user, provider, period) — partial-unique so NULLs don't collide.
CREATE UNIQUE INDEX budgets_scope_uniq ON public.budgets (
  org_id,
  coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(user_id,    '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(provider, ''),
  period
);

-- 4. cloud_billing_connections (external billing API credentials) ------------
CREATE TABLE public.cloud_billing_connections (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider              text        NOT NULL,
  name                  text        NOT NULL,
  credentials_encrypted jsonb       NOT NULL DEFAULT '{}',
  is_active             boolean     NOT NULL DEFAULT true,
  last_synced_at        timestamptz,
  sync_error            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- 5. mcp_cost_reconciliation (estimated vs actual infra cost) ----------------
CREATE TABLE public.mcp_cost_reconciliation (
  id             uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id       text          NOT NULL,
  session_id     text          NOT NULL,
  estimated_cost numeric(14,9) NOT NULL DEFAULT 0,
  actual_cost    numeric(14,9) NOT NULL,
  cost_source    text          NOT NULL,
  resource_name  text,
  operation_type text,
  environment    text,
  reconciled_at  timestamptz   DEFAULT now(),
  UNIQUE (org_id, event_id)
);

-- 6. training_runs (fine-tuning / training cost records) ---------------------
CREATE TABLE public.training_runs (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id      uuid          REFERENCES public.projects(id)               ON DELETE SET NULL,
  provider        text          NOT NULL,
  external_job_id text,
  name            text,
  status          text          NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','running','completed','failed','cancelled')),
  model_base      text,
  model_output    text,
  cost_usd        numeric(12,4),
  tokens_trained  bigint,
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- 7. action_definitions (unit economics: action → cost) ---------------------
CREATE TABLE public.action_definitions (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text          NOT NULL,
  feature_tag     text,
  action_tag      text          NOT NULL,
  cost_per_action numeric(12,6),
  currency        text          NOT NULL DEFAULT 'usd',
  created_at      timestamptz   NOT NULL DEFAULT now()
);

-- 8. report_schedules (automated chargeback/FinOps delivery) -----------------
CREATE TABLE public.report_schedules (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text        NOT NULL,
  schedule_cron text        NOT NULL,
  recipients    text[]      NOT NULL DEFAULT '{}',
  format        text        NOT NULL DEFAULT 'csv' CHECK (format IN ('csv','json')),
  report_type   text        NOT NULL DEFAULT 'chargeback' CHECK (report_type IN ('chargeback','finops','usage')),
  filters       jsonb       NOT NULL DEFAULT '{}',
  is_active     boolean     NOT NULL DEFAULT true,
  last_sent_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 9. customer_quota_profiles (multi-tenant billing passthrough) --------------
CREATE TABLE public.customer_quota_profiles (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  customer_id         text        NOT NULL,
  display_name        text,
  monthly_spend_usd   numeric(12,6),
  monthly_token_limit bigint,
  soft_cap_pct        int         NOT NULL DEFAULT 80 CHECK (soft_cap_pct BETWEEN 1 AND 100),
  soft_cap_model      text,
  is_active           boolean     NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, customer_id)
);

-- 10. tool_cost_catalog (MCP tool estimated-cost patterns) -------------------
CREATE TABLE public.tool_cost_catalog (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pattern            text          NOT NULL,
  estimated_cost_usd numeric(12,6) NOT NULL,
  description        text,
  created_at         timestamptz   NOT NULL DEFAULT now()
);

-- 11. INDEXES ----------------------------------------------------------------
CREATE INDEX idx_budgets_org_id        ON public.budgets(org_id);
CREATE INDEX idx_budgets_project_id    ON public.budgets(project_id);
CREATE INDEX idx_mcp_reconcile_session ON public.mcp_cost_reconciliation(org_id, session_id);
CREATE INDEX idx_mcp_reconcile_resource ON public.mcp_cost_reconciliation(org_id, resource_name);
CREATE INDEX idx_training_runs_org     ON public.training_runs(org_id, created_at DESC);
CREATE INDEX idx_action_defs_org       ON public.action_definitions(org_id);
CREATE INDEX idx_cloud_billing_org     ON public.cloud_billing_connections(org_id);
CREATE INDEX idx_customer_quota_org    ON public.customer_quota_profiles(org_id);
CREATE INDEX idx_report_schedules_org  ON public.report_schedules(org_id);
CREATE INDEX idx_tool_cost_catalog_org ON public.tool_cost_catalog(org_id);

-- 12. updated_at TRIGGERS ----------------------------------------------------
CREATE TRIGGER budgets_updated_at BEFORE UPDATE ON public.budgets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER customer_quota_profiles_updated_at BEFORE UPDATE ON public.customer_quota_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 13. ROW LEVEL SECURITY (member read, admin write; billing creds = admin-only)
ALTER TABLE public.budgets                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_billing_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_cost_reconciliation   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.training_runs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.action_definitions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_schedules          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_quota_profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_cost_catalog         ENABLE ROW LEVEL SECURITY;

CREATE POLICY budgets_select ON public.budgets FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY budgets_write  ON public.budgets FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- billing credentials are sensitive → admin read + write only
CREATE POLICY cbc_all ON public.cloud_billing_connections FOR ALL
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

CREATE POLICY mcr_select ON public.mcp_cost_reconciliation FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY mcr_write  ON public.mcp_cost_reconciliation FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY tr_select  ON public.training_runs FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY tr_write   ON public.training_runs FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY ad_select  ON public.action_definitions FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY ad_write   ON public.action_definitions FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY rs_select  ON public.report_schedules FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY rs_write   ON public.report_schedules FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY cqp_select ON public.customer_quota_profiles FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY cqp_write  ON public.customer_quota_profiles FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY tcc_select ON public.tool_cost_catalog FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY tcc_write  ON public.tool_cost_catalog FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
