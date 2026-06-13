-- =============================================================================
-- PRISM (staging) — RBAC FOUNDATION  (exact Supabase access-control model)
--   Roles : owner > administrator > developer > read_only
--   Scope : organization-wide  OR  project-scoped (member_project_roles)
--   Rules : >= 1 org-scoped owner per org; invites expire in 24h
-- =============================================================================

-- 1. ROLE TYPE ----------------------------------------------------------------
CREATE TYPE public.org_role AS ENUM ('owner', 'administrator', 'developer', 'read_only');

-- 2. SHARED TRIGGER -----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- 3. CORE IDENTITY & ORG HIERARCHY -------------------------------------------
CREATE TABLE public.organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            text NOT NULL UNIQUE,
  plan            text NOT NULL DEFAULT 'free'
                  CHECK (plan IN ('free','solo','startup','enterprise')),
  onboarding_step integer NOT NULL DEFAULT 0,
  trial_ends_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name        text NOT NULL,
  slug        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

-- members: ONE row per (org, user).
--   scope_type='organization' -> role applies to ALL projects (role NOT NULL)
--   scope_type='project'      -> role NULL; grants live in member_project_roles
CREATE TABLE public.members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope_type text NOT NULL DEFAULT 'organization'
             CHECK (scope_type IN ('organization','project')),
  role       public.org_role,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id),
  CONSTRAINT members_scope_role_chk CHECK (
    (scope_type = 'organization' AND role IS NOT NULL) OR
    (scope_type = 'project'      AND role IS NULL)
  )
);

-- per-project grants for project-scoped members (Supabase "project-scoped roles")
CREATE TABLE public.member_project_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role       public.org_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, project_id)
);

-- active-org selector (the app resolves "current org" from here)
CREATE TABLE public.user_preferences (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  active_org_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  theme         text NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 4. INVITATIONS (24h expiry; optional SAML-SSO restriction) ------------------
CREATE TABLE public.pending_invites (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email        text NOT NULL,
  scope_type   text NOT NULL DEFAULT 'organization'
               CHECK (scope_type IN ('organization','project')),
  role         public.org_role,                 -- org-wide role when scope='organization'
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sso_only     boolean NOT NULL DEFAULT false,  -- SAML-SSO-only acceptance
  sso_provider text,
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invite_scope_role_chk CHECK (
    (scope_type = 'organization' AND role IS NOT NULL) OR
    (scope_type = 'project'      AND role IS NULL)
  )
);

CREATE TABLE public.pending_invite_projects (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id  uuid NOT NULL REFERENCES public.pending_invites(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role       public.org_role NOT NULL,
  UNIQUE (invite_id, project_id)
);

-- 5. RLS HELPER FUNCTIONS (encode the permission matrix) ----------------------
-- effective ORG-WIDE role for caller (NULL if not an org-scoped member)
CREATE OR REPLACE FUNCTION public.org_role_for(p_org_id uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT role FROM public.members
  WHERE org_id = p_org_id AND user_id = auth.uid() AND scope_type = 'organization';
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM public.members
                 WHERE org_id = p_org_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.org_role_for(p_org_id) = 'owner';
$$;

-- owner OR administrator — the org-write "canManage" gate
CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.org_role_for(p_org_id) IN ('owner','administrator');
$$;

-- caller's effective role ON a project: org-wide role if org-scoped, else project grant
CREATE OR REPLACE FUNCTION public.project_role_for(p_project_id uuid)
RETURNS public.org_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT m.role FROM public.members m
       JOIN public.projects p ON p.org_id = m.org_id
      WHERE p.id = p_project_id AND m.user_id = auth.uid()
        AND m.scope_type = 'organization'),
    (SELECT mpr.role FROM public.member_project_roles mpr
       JOIN public.members m ON m.id = mpr.member_id
      WHERE mpr.project_id = p_project_id AND m.user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.project_role_for(p_project_id) IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.can_write_project(p_project_id uuid)  -- excludes read_only
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.project_role_for(p_project_id) IN ('owner','administrator','developer'); $$;

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid) -- settings: owner/admin
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT public.project_role_for(p_project_id) IN ('owner','administrator'); $$;

-- 6. INVARIANT: >= 1 organization-scoped owner per org -----------------------
CREATE OR REPLACE FUNCTION public.enforce_min_one_owner()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_org uuid; v_owners int;
BEGIN
  v_org := COALESCE(OLD.org_id, NEW.org_id);
  -- Skip when the org itself is gone (e.g. cascade delete of the organization),
  -- otherwise deleting an org would leave 0 owners at commit and wrongly raise.
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_org) THEN
    RETURN NULL;
  END IF;
  SELECT count(*) INTO v_owners FROM public.members
   WHERE org_id = v_org AND scope_type = 'organization' AND role = 'owner';
  IF v_owners = 0 THEN
    RAISE EXCEPTION 'org_must_have_at_least_one_owner';
  END IF;
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER members_min_one_owner
  AFTER UPDATE OR DELETE ON public.members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.enforce_min_one_owner();

-- 7. OWNERSHIP TRANSFER (atomic; preserves the invariant) --------------------
CREATE OR REPLACE FUNCTION public.transfer_org_ownership(
  p_org_id uuid, p_current_owner uuid, p_new_owner uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_current_owner = p_new_owner THEN RAISE EXCEPTION 'already_owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members
     WHERE org_id=p_org_id AND user_id=p_current_owner
       AND scope_type='organization' AND role='owner')
    THEN RAISE EXCEPTION 'not_current_owner'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members
     WHERE org_id=p_org_id AND user_id=p_new_owner)
    THEN RAISE EXCEPTION 'target_not_member'; END IF;

  UPDATE public.members SET scope_type='organization', role='owner'
    WHERE org_id=p_org_id AND user_id=p_new_owner;
  DELETE FROM public.member_project_roles mpr USING public.members m
    WHERE mpr.member_id=m.id AND m.org_id=p_org_id AND m.user_id=p_new_owner; -- promoted: no longer project-scoped
  UPDATE public.members SET role='administrator'
    WHERE org_id=p_org_id AND user_id=p_current_owner;
END; $$;

-- 8. INDEXES ------------------------------------------------------------------
CREATE INDEX idx_members_user_id   ON public.members(user_id);
CREATE INDEX idx_members_org_id    ON public.members(org_id);
CREATE INDEX idx_mpr_member_id     ON public.member_project_roles(member_id);
CREATE INDEX idx_mpr_project_id    ON public.member_project_roles(project_id);
CREATE INDEX idx_projects_org_id   ON public.projects(org_id);
CREATE INDEX idx_invites_org_id    ON public.pending_invites(org_id);
CREATE INDEX idx_invite_projects   ON public.pending_invite_projects(invite_id);

-- 9. TRIGGERS (updated_at) ----------------------------------------------------
CREATE TRIGGER organizations_updated_at BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER user_preferences_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. ROW LEVEL SECURITY ------------------------------------------------------
ALTER TABLE public.organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_project_roles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_invites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_invite_projects ENABLE ROW LEVEL SECURITY;

-- organizations: members read; owner-only update/delete (org settings = owner)
CREATE POLICY org_select ON public.organizations FOR SELECT USING (public.is_org_member(id));
CREATE POLICY org_update ON public.organizations FOR UPDATE USING (public.is_org_owner(id));
CREATE POLICY org_delete ON public.organizations FOR DELETE USING (public.is_org_owner(id));
-- (org + first-owner bootstrap runs via service role, which bypasses RLS)

-- members: everyone in the org can list; owner rows need owner, others need admin
CREATE POLICY members_select ON public.members FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY members_write_owner ON public.members FOR ALL
  USING (public.is_org_owner(org_id)) WITH CHECK (public.is_org_owner(org_id));
CREATE POLICY members_write_nonowner ON public.members FOR ALL
  USING (public.is_org_admin(org_id) AND role IS DISTINCT FROM 'owner')
  WITH CHECK (public.is_org_admin(org_id) AND role IS DISTINCT FROM 'owner');

-- member_project_roles: read by org members; manage by org admins or project admins
CREATE POLICY mpr_select ON public.member_project_roles FOR SELECT USING (
  public.is_org_member((SELECT org_id FROM public.projects WHERE id = project_id)));
CREATE POLICY mpr_write ON public.member_project_roles FOR ALL USING (
  public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id))
  OR public.can_manage_project(project_id)
) WITH CHECK (
  public.is_org_admin((SELECT org_id FROM public.projects WHERE id = project_id))
  OR public.can_manage_project(project_id));

-- projects: visibility = can_read_project (project-scoped members see only assigned);
--           create = org admin; update/delete = owner/admin (project settings)
CREATE POLICY projects_select ON public.projects FOR SELECT USING (public.can_read_project(id));
CREATE POLICY projects_insert ON public.projects FOR INSERT WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY projects_update ON public.projects FOR UPDATE USING (public.can_manage_project(id));
CREATE POLICY projects_delete ON public.projects FOR DELETE USING (public.can_manage_project(id));

-- user_preferences: own row only
CREATE POLICY prefs_all ON public.user_preferences FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- pending_invites: members read; owner-role invites need owner, others need admin
CREATE POLICY invites_select ON public.pending_invites FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY invites_write_owner ON public.pending_invites FOR ALL
  USING (public.is_org_owner(org_id)) WITH CHECK (public.is_org_owner(org_id));
CREATE POLICY invites_write_nonowner ON public.pending_invites FOR ALL
  USING (public.is_org_admin(org_id) AND role IS DISTINCT FROM 'owner')
  WITH CHECK (public.is_org_admin(org_id) AND role IS DISTINCT FROM 'owner');

CREATE POLICY invite_projects_all ON public.pending_invite_projects FOR ALL USING (
  public.is_org_admin((SELECT org_id FROM public.pending_invites WHERE id = invite_id))
) WITH CHECK (
  public.is_org_admin((SELECT org_id FROM public.pending_invites WHERE id = invite_id)));
