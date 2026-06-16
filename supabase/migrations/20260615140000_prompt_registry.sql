-- =============================================================================
-- PRISM (staging) — PRD-4: Prompt Management & Playground (Phase 2, Dev loop)
--   A Langfuse-style prompt registry, three tables:
--     prompts          — a named prompt (unique per org+project).
--     prompt_versions  — immutable, monotonically-versioned content+config.
--     prompt_labels    — movable pointers (production/staging/…) → one version.
--   Resolved calls stamp tags['prompt_version'] = name@version so the EXISTING
--   spend_by_prompt_version pipe + /api/metrics/prompt-versions light up with no
--   pipe change. Design: docs/implementation/04-prompt-management-playground.impl.md
-- =============================================================================

-- 1. prompts ------------------------------------------------------------------
CREATE TABLE public.prompts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES public.projects(id) ON DELETE CASCADE,   -- null = org-level
  name        text        NOT NULL,
  description text,
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id, name)
);

-- 2. prompt_versions (append-only / immutable) --------------------------------
CREATE TABLE public.prompt_versions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   uuid        NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version     integer     NOT NULL,                          -- monotonic per prompt
  content     jsonb       NOT NULL,                          -- messages array [{role,content}]
  config      jsonb       NOT NULL DEFAULT '{}'::jsonb,      -- model defaults, temperature, …
  commit_msg  text,                                          -- optional change note
  created_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, version)
);

-- 3. prompt_labels (movable pointer → exactly one version) --------------------
CREATE TABLE public.prompt_labels (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id   uuid        NOT NULL REFERENCES public.prompts(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label       text        NOT NULL,                          -- 'production' | 'staging' | …
  version_id  uuid        NOT NULL REFERENCES public.prompt_versions(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prompt_id, label)
);

-- RLS: read = any org member; write = canWriteOrg (owner/administrator/developer; read_only blocked).
ALTER TABLE public.prompts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prompt_labels   ENABLE ROW LEVEL SECURITY;
CREATE POLICY pr_select ON public.prompts         FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pr_write  ON public.prompts         FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE POLICY pv_select ON public.prompt_versions FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pv_write  ON public.prompt_versions FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE POLICY pl_select ON public.prompt_labels   FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY pl_write  ON public.prompt_labels   FOR ALL USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));

CREATE INDEX idx_prompts_org   ON public.prompts(org_id, project_id);
CREATE INDEX idx_pv_prompt     ON public.prompt_versions(prompt_id, version DESC);
CREATE INDEX idx_pl_prompt     ON public.prompt_labels(prompt_id);

CREATE TRIGGER prompts_updated_at BEFORE UPDATE ON public.prompts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER prompt_labels_updated_at BEFORE UPDATE ON public.prompt_labels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enforce version immutability at the DB layer (API has no UPDATE route either).
CREATE OR REPLACE FUNCTION public.prevent_prompt_version_update() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'prompt_versions are immutable; append a new version instead';
END;
$$;
CREATE TRIGGER prompt_versions_immutable BEFORE UPDATE ON public.prompt_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_prompt_version_update();
