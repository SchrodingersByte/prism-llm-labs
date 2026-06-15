-- =============================================================================
-- PRISM (staging) — PRD-0: Content & Embedding Capture (Phase 0)
--   Generalizes request_logs into the unified content store (adds retrieved
--   context, tool I/O, redaction metadata, source, event_id, retention TTL),
--   adds per-project content_capture_settings, and a pgvector content_embeddings
--   table. Design: docs/implementation/00-content-embedding-capture.impl.md
--
--   Locked decisions: v1 payloads stay in Supabase request_logs; embeddings via
--   the gateway as vector(1536); residency is an indicator (single-region note).
-- =============================================================================

-- 1. pgvector (embeddings) ----------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Generalize request_logs into the unified content store -------------------
ALTER TABLE public.request_logs
  ADD COLUMN IF NOT EXISTS context         jsonb,
  ADD COLUMN IF NOT EXISTS tool_io         jsonb,
  ADD COLUMN IF NOT EXISTS redaction_level text    NOT NULL DEFAULT 'none'
        CHECK (redaction_level IN ('none','redacted','dropped')),
  ADD COLUMN IF NOT EXISTS pii_found       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source          text    NOT NULL DEFAULT 'gateway'
        CHECK (source IN ('gateway','sdk','otel')),
  ADD COLUMN IF NOT EXISTS event_id        text,
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz;

CREATE INDEX IF NOT EXISTS idx_request_logs_event   ON public.request_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_expires ON public.request_logs(expires_at);

-- 3. Per-project capture settings (supersedes per-key prompt_logging_enabled;
--    back-compat with that flag is handled in lib/content/store.ts) -----------
CREATE TABLE public.content_capture_settings (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id         uuid        REFERENCES public.projects(id) ON DELETE CASCADE,  -- null = org default
  level              text        NOT NULL DEFAULT 'off'
                     CHECK (level IN ('off','metadata_only','redacted_content','full_content')),
  payload_ttl_days   integer     NOT NULL DEFAULT 30 CHECK (payload_ttl_days BETWEEN 1 AND 3650),
  embed_enabled      boolean     NOT NULL DEFAULT false,
  embed_model        text,
  residency_override text,
  updated_by         uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id)
);
CREATE INDEX idx_ccs_org ON public.content_capture_settings(org_id);

ALTER TABLE public.content_capture_settings ENABLE ROW LEVEL SECURITY;

-- read: any org member; write: org admin OR a manager of the named project
CREATE POLICY ccs_select ON public.content_capture_settings FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY ccs_write ON public.content_capture_settings FOR ALL
  USING      (public.is_org_admin(org_id) OR public.can_manage_project(project_id))
  WITH CHECK (public.is_org_admin(org_id) OR public.can_manage_project(project_id));

CREATE TRIGGER content_capture_settings_updated_at BEFORE UPDATE ON public.content_capture_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Embeddings (pgvector) ----------------------------------------------------
CREATE TABLE public.content_embeddings (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  event_id   text        NOT NULL,
  trace_id   text,
  span_id    text,
  kind       text        NOT NULL CHECK (kind IN ('prompt','completion')),
  embedding  vector(1536),
  model      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_content_embeddings_event ON public.content_embeddings(event_id);
CREATE INDEX idx_content_embeddings_org   ON public.content_embeddings(org_id, created_at DESC);
-- (ivfflat/hnsw ANN index deferred to PRD-5 when drift/NN queries land)

ALTER TABLE public.content_embeddings ENABLE ROW LEVEL SECURITY;
-- service-written analytics: members read only
CREATE POLICY ce_select ON public.content_embeddings FOR SELECT USING (public.is_org_member(org_id));
