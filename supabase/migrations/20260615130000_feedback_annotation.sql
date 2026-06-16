-- =============================================================================
-- PRISM (staging) — PRD-3: Feedback & Annotation Queues (Phase 1, parallel w/ PRD-1)
--   Two net-new tables:
--     feedback         — end-user thumbs/score/comment, key-authed ingest (like
--                        outcome_events). feature_tag added so thumbs aggregate
--                        per feature (a PRD-3 success metric).
--     annotation_queue — human-review worklist, auto-populated by the PRD-1
--                        sampler (edge / low-confidence / disagreement) + manual
--                        enqueue. Reviewer submissions land as human rows in the
--                        existing eval_scores (scorer_type='human') — no new score
--                        store — closing the judge↔human calibration loop w/ PRD-1.
--   Design: docs/implementation/03-feedback-annotation-queues.impl.md
-- =============================================================================

-- 1. feedback (end-user thumbs / scores) -------------------------------------
CREATE TABLE public.feedback (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key_id  uuid        REFERENCES public.api_keys(id) ON DELETE SET NULL,
  source      text        NOT NULL DEFAULT 'end_user' CHECK (source IN ('end_user','reviewer')),
  feature_tag text,                                          -- correlates to x-prism-feature for per-feature thumbs
  trace_id    text,
  span_id     text,
  session_id  text,
  value       numeric,                                       -- thumbs: 1 / 0 ; or a 0..1 score
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
-- read: any org member. writes are service-role (key-authed route) — no user INSERT
-- policy, matching outcome_events.
CREATE POLICY fb_select ON public.feedback FOR SELECT USING (public.is_org_member(org_id));
CREATE INDEX idx_feedback_org     ON public.feedback(org_id, created_at DESC);
CREATE INDEX idx_feedback_trace   ON public.feedback(trace_id);
CREATE INDEX idx_feedback_feature ON public.feedback(org_id, feature_tag);

-- 2. annotation_queue (human-review worklist) --------------------------------
CREATE TABLE public.annotation_queue (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  trace_id    text,
  span_id     text,
  session_id  text,
  eval_run_id uuid        REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
  status      text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','done','skipped')),
  priority    integer     NOT NULL DEFAULT 0,                -- higher = reviewed first
  reason      text,                                          -- 'edge' | 'judge_disagreement' | 'low_confidence' | 'sampled' | 'manual'
  assignee    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.annotation_queue ENABLE ROW LEVEL SECURITY;
-- read: any org member; write: org-scoped owner/administrator/developer (canWriteOrg), not read_only.
CREATE POLICY aq_select ON public.annotation_queue FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY aq_write  ON public.annotation_queue FOR ALL
  USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE INDEX idx_aq_org_status ON public.annotation_queue(org_id, status, priority DESC, created_at DESC);
-- de-dupe: one open queue item per (org, trace, span) so the sampler can't pile up duplicates.
CREATE UNIQUE INDEX idx_aq_unique_open
  ON public.annotation_queue(org_id, trace_id, COALESCE(span_id, ''))
  WHERE status IN ('pending','in_review');

CREATE TRIGGER annotation_queue_updated_at BEFORE UPDATE ON public.annotation_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
