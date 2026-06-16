-- =============================================================================
-- PRISM (staging) — PRD-5: Drift & Embeddings Analysis (Phase 3, Advanced/DS)
--   Drift metrics + topic clusters over PRD-0's content_embeddings, plus the
--   pgvector ANN index deferred from PRD-0.
--
--   Storage note (correction to the impl sketch): drift_metrics lives in
--   SUPABASE, not Tinybird. These are low-cardinality aggregates (a few rows per
--   cron run per segment), not per-event telemetry — Supabase is the right home,
--   it avoids a Tinybird `tb deploy` dependency, and it sits next to `clusters`
--   (already specced as Supabase). Design:
--   docs/implementation/05-drift-embeddings-analysis.impl.md
-- =============================================================================

-- 1. drift_metrics (rolling-window drift, per segment) ------------------------
CREATE TABLE public.drift_metrics (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  segment       text        NOT NULL DEFAULT 'all' CHECK (segment IN ('all','model','feature','project')),
  segment_value text,                                          -- e.g. the model name, null for 'all'
  metric        text        NOT NULL CHECK (metric IN ('psi','js','centroid_cosine','mmd')),
  value         numeric     NOT NULL,
  baseline_ref  text,                                          -- describes the baseline window (e.g. '7d')
  sample_size   integer,
  computed_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.drift_metrics ENABLE ROW LEVEL SECURITY;
-- read: any org member. writes are service-role only (the cron) — no write policy.
CREATE POLICY dm_select ON public.drift_metrics FOR SELECT USING (public.is_org_member(org_id));
CREATE INDEX idx_drift_org      ON public.drift_metrics(org_id, computed_at DESC);
CREATE INDEX idx_drift_segment  ON public.drift_metrics(org_id, segment, segment_value, metric, computed_at DESC);

-- 2. clusters (topic/intent metadata per window) -----------------------------
CREATE TABLE public.clusters (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id    uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  label         text,                                          -- representative snippet nearest the centroid
  size          integer     NOT NULL DEFAULT 0,
  keywords      jsonb       NOT NULL DEFAULT '[]'::jsonb,      -- a few representative snippets
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clusters ENABLE ROW LEVEL SECURITY;
CREATE POLICY cl_select ON public.clusters FOR SELECT USING (public.is_org_member(org_id));
CREATE INDEX idx_clusters_org ON public.clusters(org_id, created_at DESC);

-- 3. pgvector ANN index on content_embeddings (deferred from PRD-0) ----------
--    Cosine ops match the drift/cluster math. ivfflat builds fine on an empty
--    table; lists=100 is a sane default for the expected sampled volumes.
CREATE INDEX IF NOT EXISTS idx_content_embeddings_vec
  ON public.content_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
