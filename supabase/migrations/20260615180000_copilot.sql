-- =============================================================================
-- PRISM (staging) — PRD-7: Prism Copilot (NL query + agentic RCA)
--   Persists Copilot conversations + messages. The agent itself reads the
--   EXISTING Tinybird pipes via a semantic catalog (lib/copilot/catalog.ts) —
--   no analytics datasources are needed. Messages store tool-call provenance
--   (which pipes ran + params + row counts) so every answer is auditable.
--   Design: docs/implementation/07-prism-copilot-nl-agentic-rca.impl.md
-- =============================================================================

CREATE TABLE public.copilot_conversations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.copilot_messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES public.copilot_conversations(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            text        NOT NULL CHECK (role IN ('user','assistant','tool')),
  content         text,
  tool_calls      jsonb,        -- pipes called + params + row counts (provenance)
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.copilot_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.copilot_messages      ENABLE ROW LEVEL SECURITY;

-- read + write: any org member (conversations are personal-but-org-scoped; the
-- route also filters by user_id). Service-role writes bypass RLS.
CREATE POLICY cc_select ON public.copilot_conversations FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY cc_write  ON public.copilot_conversations FOR ALL
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));
CREATE POLICY cm_select ON public.copilot_messages FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY cm_write  ON public.copilot_messages FOR ALL
  USING (public.is_org_member(org_id)) WITH CHECK (public.is_org_member(org_id));

CREATE INDEX idx_cc_org  ON public.copilot_conversations(org_id, created_at DESC);
CREATE INDEX idx_cm_conv ON public.copilot_messages(conversation_id, created_at);
