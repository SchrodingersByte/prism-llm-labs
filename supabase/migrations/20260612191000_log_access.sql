-- =============================================================================
-- PRISM (staging) — WS2c: rebuild log_access_requests (prompt-log access gate)
--   A project collaborator (project-scoped member, or any non-manager) requests
--   access to a project's prompt/completion logs; a manager (org owner/admin OR
--   project owner/administrator) approves/denies. The 7-phase rebuild dropped
--   this table + project_members.log_access_approved; the user chose to REBUILD.
--
--   Approval state lives in the request row's `status` (no denormalized boolean).
--   "Has log access" = can_manage_project(p) OR an approved row for (project,user).
-- =============================================================================

CREATE TABLE public.log_access_requests (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES public.projects(id)      ON DELETE CASCADE,
  requester_id uuid        NOT NULL REFERENCES auth.users(id)           ON DELETE CASCADE,
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'denied')),
  message      text,
  resolved_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, requester_id)
);

CREATE INDEX idx_log_access_project ON public.log_access_requests(project_id, status);
CREATE INDEX idx_log_access_org     ON public.log_access_requests(org_id);

ALTER TABLE public.log_access_requests ENABLE ROW LEVEL SECURITY;

-- read: the requester sees their own; managers (org admin or project manager) see all in scope
CREATE POLICY lar_select ON public.log_access_requests FOR SELECT USING (
  requester_id = auth.uid()
  OR public.is_org_admin(org_id)
  OR public.can_manage_project(project_id)
);

-- file a request: only for yourself, and only on a project you can read
CREATE POLICY lar_insert ON public.log_access_requests FOR INSERT WITH CHECK (
  requester_id = auth.uid() AND public.can_read_project(project_id)
);

-- resolve (approve/deny): managers in scope
CREATE POLICY lar_resolve ON public.log_access_requests FOR UPDATE
  USING      (public.is_org_admin(org_id) OR public.can_manage_project(project_id))
  WITH CHECK (public.is_org_admin(org_id) OR public.can_manage_project(project_id));

-- cleanup: managers in scope
CREATE POLICY lar_delete ON public.log_access_requests FOR DELETE USING (
  public.is_org_admin(org_id) OR public.can_manage_project(project_id)
);
