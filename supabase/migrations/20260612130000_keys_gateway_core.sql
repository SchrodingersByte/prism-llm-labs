-- =============================================================================
-- PRISM (staging) — PHASE 2: KEYS & GATEWAY CORE
--   Prism API keys + per-key caps + encrypted provider keys + N:N links.
--   Plus the two org-level gateway controls the gateway reads on every request.
--   RLS reuses the Phase-1 RBAC helpers (4-role / org+project scope).
-- =============================================================================

-- 1. organizations: minimal gateway controls --------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS gateway_mode text NOT NULL DEFAULT 'sdk_optional'
    CHECK (gateway_mode IN ('sdk_optional','gateway_required')),
  ADD COLUMN IF NOT EXISTS data_residency_policy text NOT NULL DEFAULT 'any'
    CHECK (data_residency_policy IN ('any','eu_only','us_only','india_only'));

-- 2. api_keys (gateway/SDK auth). project_id NULL = org-level key ------------
CREATE TABLE public.api_keys (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id             uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  name                   text NOT NULL,
  key_hash               text NOT NULL UNIQUE,
  key_prefix             text NOT NULL,
  environment            text NOT NULL DEFAULT 'development'
                         CHECK (environment IN ('production','staging','development')),
  is_active              boolean NOT NULL DEFAULT true,
  tags                   jsonb   NOT NULL DEFAULT '{}',
  prompt_logging_enabled boolean NOT NULL DEFAULT false,   -- gates request_logs (Phase 5)
  expires_at             timestamptz,
  auto_paused_at         timestamptz,
  auto_pause_reason      text,
  last_used_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- 3. key_caps (daily/weekly/monthly spend caps) -----------------------------
CREATE TABLE public.key_caps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  period     text NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  amount_usd numeric(12,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, period)
);

-- 4. provider_keys (encrypted upstream LLM keys). No provider CHECK — the
--    app's zod enum is the single source of truth for valid providers. -------
CREATE TABLE public.provider_keys (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id             uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  provider               text NOT NULL,
  name                   text NOT NULL,
  key_encrypted          text NOT NULL,
  key_hint               text NOT NULL,
  is_active              boolean NOT NULL DEFAULT true,
  azure_endpoint         text,
  custom_endpoint        text,
  aws_region             text,
  allowed_models         text[] NOT NULL DEFAULT '{}',
  data_region            text NOT NULL DEFAULT 'global' CHECK (data_region IN ('global','eu','us','in')),
  use_for_reconciliation boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- 5. key_provider_links (N:N; is_primary picks the default route) ------------
CREATE TABLE public.key_provider_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id      uuid NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE,
  provider_key_id uuid NOT NULL REFERENCES public.provider_keys(id) ON DELETE CASCADE,
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (api_key_id, provider_key_id)
);

-- 6. INDEXES ----------------------------------------------------------------
CREATE INDEX idx_api_keys_org_id       ON public.api_keys(org_id);
CREATE INDEX idx_api_keys_project_id   ON public.api_keys(project_id);
CREATE INDEX idx_key_caps_api_key_id   ON public.key_caps(api_key_id);
CREATE INDEX idx_provider_keys_org_id  ON public.provider_keys(org_id);
CREATE INDEX idx_kpl_api_key_id        ON public.key_provider_links(api_key_id);

-- 7. ROW LEVEL SECURITY (reuses Phase-1 helpers) ----------------------------
ALTER TABLE public.api_keys           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_caps           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_keys      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_provider_links ENABLE ROW LEVEL SECURITY;

-- api_keys: org-scoped members see all org keys; project-scoped members see only
-- their projects' keys. Manage = org admin OR a project writer (not read_only).
CREATE POLICY api_keys_select ON public.api_keys FOR SELECT USING (
  public.org_role_for(org_id) IS NOT NULL
  OR (project_id IS NOT NULL AND public.can_read_project(project_id)));
CREATE POLICY api_keys_write ON public.api_keys FOR ALL
  USING (public.is_org_admin(org_id) OR (project_id IS NOT NULL AND public.can_write_project(project_id)))
  WITH CHECK (public.is_org_admin(org_id) OR (project_id IS NOT NULL AND public.can_write_project(project_id)));

-- provider_keys hold secrets → read any org member, write org admin only.
CREATE POLICY provider_keys_select ON public.provider_keys FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY provider_keys_write  ON public.provider_keys FOR ALL
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));

-- key_caps + key_provider_links inherit the parent api_key's access rule.
CREATE POLICY key_caps_all ON public.key_caps FOR ALL USING (
  EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_id
          AND (public.is_org_admin(k.org_id) OR (k.project_id IS NOT NULL AND public.can_write_project(k.project_id)))))
  WITH CHECK (
  EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_id
          AND (public.is_org_admin(k.org_id) OR (k.project_id IS NOT NULL AND public.can_write_project(k.project_id)))));
CREATE POLICY kpl_select ON public.key_provider_links FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_id AND public.is_org_member(k.org_id)));
CREATE POLICY kpl_write ON public.key_provider_links FOR ALL
  USING (
  EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_id
          AND (public.is_org_admin(k.org_id) OR (k.project_id IS NOT NULL AND public.can_write_project(k.project_id)))))
  WITH CHECK (
  EXISTS (SELECT 1 FROM public.api_keys k WHERE k.id = api_key_id
          AND (public.is_org_admin(k.org_id) OR (k.project_id IS NOT NULL AND public.can_write_project(k.project_id)))));
