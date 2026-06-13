-- =============================================================================
-- PRISM (staging) — PHASE 6: ACCOUNTS / INTEGRATIONS / PLATFORM
--   Enterprise account+SSO layer, teams, SCM (GitHub/generic) + Slack
--   integrations, platform feature catalog, and user consents. Columns verified
--   against database.types.ts. Integration secrets get admin-only RLS.
--   NOTE: legacy project_members / log_access_requests are intentionally NOT
--   recreated — staging uses member_project_roles.
-- =============================================================================

-- 1. accounts + account_members (enterprise umbrella over orgs) ---------------
CREATE TABLE public.accounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  plan        text DEFAULT 'enterprise' CHECK (plan IS NULL OR plan IN ('enterprise','enterprise_plus')),
  sso_enabled boolean DEFAULT false,
  created_at  timestamptz DEFAULT now()
);
CREATE TABLE public.account_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES auth.users(id)      ON DELETE CASCADE,
  role       text DEFAULT 'admin' CHECK (role IN ('owner','admin')),
  created_at timestamptz DEFAULT now(),
  UNIQUE (account_id, user_id)
);

-- account-membership helper (defined here — LANGUAGE sql validates the body at
-- creation time, so account_members must already exist). Avoids RLS recursion.
CREATE OR REPLACE FUNCTION public.is_account_member(p_account_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.account_members
    WHERE account_id = p_account_id AND user_id = auth.uid()
  );
$$;

-- 2. sso_configs (SAML/OIDC per account domain) ------------------------------
CREATE TABLE public.sso_configs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid REFERENCES public.accounts(id) ON DELETE CASCADE,
  provider         text NOT NULL,
  domain           text NOT NULL,
  client_id        text,
  client_secret    text,
  issuer           text,
  idp_metadata     text,
  jackson_client_id text,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- 3. teams + team_members (org grouping for cost attribution) ----------------
CREATE TABLE public.teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.team_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  added_by   uuid REFERENCES auth.users(id)             ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

-- 4. SCM integrations (GitHub OAuth + generic SCM; secrets) ------------------
CREATE TABLE public.github_connections (
  id             uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid   NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id        uuid   NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  github_login   text   NOT NULL,
  github_user_id bigint NOT NULL,
  access_token   text   NOT NULL,
  scope          text,
  installed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.scm_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider            text NOT NULL,
  provider_account_id text NOT NULL,
  provider_login      text NOT NULL,
  display_name        text,
  avatar_url          text,
  access_token        text NOT NULL,
  installation_id     text,
  scope               text,
  connected_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.project_github_repos (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid    NOT NULL REFERENCES public.projects(id)            ON DELETE CASCADE,
  connection_id  uuid    NOT NULL REFERENCES public.github_connections(id)  ON DELETE CASCADE,
  repo_owner     text    NOT NULL,
  repo_name      text    NOT NULL,
  repo_id        bigint  NOT NULL,
  default_branch text    NOT NULL DEFAULT 'main',
  is_private     boolean DEFAULT false,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, repo_id)
);
CREATE TABLE public.project_repos (
  id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid    NOT NULL REFERENCES public.projects(id)         ON DELETE CASCADE,
  connection_id  uuid    NOT NULL REFERENCES public.scm_connections(id)  ON DELETE CASCADE,
  provider       text    NOT NULL,
  repo_owner     text    NOT NULL,
  repo_name      text    NOT NULL,
  full_name      text,
  repo_id        bigint  NOT NULL,
  default_branch text    NOT NULL DEFAULT 'main',
  is_private     boolean DEFAULT false,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, repo_id)
);
CREATE TABLE public.github_repo_branches (
  id            uuid   PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id       bigint NOT NULL,
  branch_name   text   NOT NULL,
  commit_sha    text   NOT NULL,
  commit_author text,
  commit_date   timestamptz,
  pr_number     integer,
  pr_title      text,
  synced_at     timestamptz NOT NULL DEFAULT now()
);

-- 5. slack_installations (secrets) ------------------------------------------
CREATE TABLE public.slack_installations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slack_team_id   text NOT NULL,
  slack_team_name text,
  bot_token       text NOT NULL,
  bot_user_id     text NOT NULL,
  installed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- 6. platform_features (feature catalog; public read) -----------------------
CREATE TABLE public.platform_features (
  key           text        PRIMARY KEY,
  name          text        NOT NULL,
  description   text,
  category      text        NOT NULL,
  status        text        NOT NULL DEFAULT 'live' CHECK (status IN ('disabled','beta','live')),
  min_plan      text        NOT NULL DEFAULT 'free',
  override_orgs text[]      NOT NULL DEFAULT '{}',
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    text
);

-- 7. user_consents (ToS + marketing; one row per user) -----------------------
CREATE TABLE public.user_consents (
  user_id              uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tos_accepted         boolean     NOT NULL DEFAULT false,
  tos_accepted_at      timestamptz,
  tos_version          text        NOT NULL DEFAULT '2024-01',
  marketing_consent    boolean     NOT NULL DEFAULT false,
  marketing_updated_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- 8. INDEXES ----------------------------------------------------------------
CREATE INDEX idx_account_members_user ON public.account_members(user_id);
CREATE INDEX idx_sso_configs_account  ON public.sso_configs(account_id);
CREATE INDEX idx_teams_org            ON public.teams(org_id);
CREATE INDEX idx_team_members_user    ON public.team_members(user_id);
CREATE INDEX idx_github_conn_org      ON public.github_connections(org_id);
CREATE INDEX idx_scm_conn_org         ON public.scm_connections(org_id);
CREATE INDEX idx_pgr_project          ON public.project_github_repos(project_id);
CREATE INDEX idx_project_repos_project ON public.project_repos(project_id);
CREATE INDEX idx_repo_branches_repo   ON public.github_repo_branches(repo_id);
CREATE INDEX idx_slack_org            ON public.slack_installations(org_id);

-- 9. updated_at TRIGGERS -----------------------------------------------------
CREATE TRIGGER sso_configs_updated_at   BEFORE UPDATE ON public.sso_configs   FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_consents_updated_at BEFORE UPDATE ON public.user_consents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. ROW LEVEL SECURITY -----------------------------------------------------
ALTER TABLE public.accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sso_configs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_connections   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scm_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_github_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_repos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_repo_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_installations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_features    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_consents        ENABLE ROW LEVEL SECURITY;

-- accounts / account_members / sso_configs: account-membership scoped (helper avoids recursion)
CREATE POLICY accounts_all ON public.accounts FOR ALL USING (public.is_account_member(id)) WITH CHECK (public.is_account_member(id));
CREATE POLICY account_members_all ON public.account_members FOR ALL USING (public.is_account_member(account_id)) WITH CHECK (public.is_account_member(account_id));
CREATE POLICY sso_configs_all ON public.sso_configs FOR ALL USING (public.is_account_member(account_id)) WITH CHECK (public.is_account_member(account_id));

-- teams / team_members: members read, admins manage
CREATE POLICY teams_select ON public.teams FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY teams_write  ON public.teams FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY tm_select ON public.team_members FOR SELECT USING (
  public.is_org_member((SELECT org_id FROM public.teams WHERE id = team_id)));
CREATE POLICY tm_write  ON public.team_members FOR ALL USING (
  public.is_org_admin((SELECT org_id FROM public.teams WHERE id = team_id)))
  WITH CHECK (public.is_org_admin((SELECT org_id FROM public.teams WHERE id = team_id)));

-- integration secrets: admin-only read + write
CREATE POLICY gh_conn_all  ON public.github_connections FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY scm_conn_all ON public.scm_connections   FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY slack_all    ON public.slack_installations FOR ALL USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- repo links: members of the project's org read; admins manage
CREATE POLICY pgr_select ON public.project_github_repos FOR SELECT USING (
  public.is_org_member((SELECT org_id FROM public.projects WHERE id = project_id)));
CREATE POLICY pgr_write ON public.project_github_repos FOR ALL USING (
  public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id)))
  WITH CHECK (public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id)));
CREATE POLICY pr_select ON public.project_repos FOR SELECT USING (
  public.is_org_member((SELECT org_id FROM public.projects WHERE id = project_id)));
CREATE POLICY pr_write ON public.project_repos FOR ALL USING (
  public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id)))
  WITH CHECK (public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id)));

-- repo branches (no org_id): visible to members of any org owning the repo via project_github_repos
CREATE POLICY grb_select ON public.github_repo_branches FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.project_github_repos pgr
            JOIN public.projects p ON p.id = pgr.project_id
          WHERE pgr.repo_id = github_repo_branches.repo_id AND public.is_org_member(p.org_id)));

-- platform_features: public read, service-role write
CREATE POLICY features_read ON public.platform_features FOR SELECT USING (true);

-- user_consents: own row only
CREATE POLICY consents_all ON public.user_consents FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 11. SEED platform_features (min_plan in the corrected tier set) -------------
INSERT INTO public.platform_features (key, name, description, category, status, min_plan) VALUES
  ('logs',             'Logs',             'Raw LLM event log viewer',                  'analytics',     'live', 'free'),
  ('models_dashboard', 'Models',           'Per-model efficiency and spend breakdown',  'analytics',     'live', 'free'),
  ('sessions',         'Sessions',         'Session-level cost and trace analytics',    'analytics',     'live', 'pro'),
  ('agents',           'Agents / MCP',     'MCP tool cost and agent loop analytics',    'analytics',     'live', 'pro'),
  ('finops',           'FinOps',           'Vendor spend, GL chargeback, cost centers', 'analytics',     'live', 'pro'),
  ('unit_economics',   'Unit Economics',   'Cost per feature, action, and outcome',     'analytics',     'live', 'pro'),
  ('training_runs',    'Training Runs',    'Fine-tuning and training job cost tracking','analytics',     'live', 'pro'),
  ('enforcement',      'Enforcement',      'Unified enforcement policy management',     'governance',    'live', 'free'),
  ('model_governance', 'Model Governance', 'Allow/block/approve per model per scope',   'governance',    'live', 'pro'),
  ('compliance_hub',   'Compliance',       'Audit log, PII masking, data residency',    'governance',    'live', 'pro'),
  ('projects',         'Projects',         'Project workspaces with cost attribution',  'collaboration', 'live', 'free'),
  ('team_management',  'Team Management',  'Invite and manage team members',            'collaboration', 'live', 'pro'),
  ('arena',            'Model Arena',      'Side-by-side multi-model playground',       'developer',     'live', 'pro'),
  ('evals',            'Evaluations',      'Model evaluation and scoring framework',    'developer',     'beta', 'pro'),
  ('engine',           'Cost Engine',      'AI-powered cost optimisation recommendations','developer',   'live', 'pro'),
  ('multi_tenant_billing','Billing Vault', 'Connect AWS, Pinecone, Qdrant billing APIs','finance',       'live', 'pro')
ON CONFLICT (key) DO NOTHING;
