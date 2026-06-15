# Code-Analysis / Implementation Design — PRD-3: Feedback & Annotation Queues

> **Implements:** [PRD-3](../prd/03-feedback-annotation-queues.md) · **Phase:** 1 (Quality core) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #3 ·
> **Depends on:** [PRD-0](00-content-embedding-capture.impl.md) (reviewer context),
> [PRD-1](01-online-evaluation-llm-judge.impl.md) (edge/disagreement triggers). **Feeds** PRD-2.

## 0. How to read this doc
Engineering design behind PRD-3. Two clean templates already exist in the repo (the outcomes ingest
and the human-score writer), so this is mostly two new tables + a queue populated by the PRD-1 sampler.

---

## 1. Current-state analysis (corrected by code reading)
### 1.1 No feedback/annotation surface exists yet
- Grep `feedback|annotation` across `app/api` → **only** `app/api/evaluations/scores/route.ts`. So
  end-user feedback ingest and the annotation queue are net-new.

### 1.2 Two reusable templates
- **Key-authed ingest** `app/api/outcomes/route.ts` is the exact pattern for `/api/feedback`:
  Bearer key → `sha256` → `api_keys` lookup (`:53-59`), zod schema, **single-or-batch envelope**
  (`:74-76`), **dual-write** Supabase `outcome_events` + Tinybird mirror (`:99-124`).
- **SDK pattern**: `EventTracker.recordOutcome()` (`packages/typescript-sdk/src/tracker.ts:332`) posts
  to `ingestUrl.replace('/api/ingest','/api/outcomes')`. ⇒ `prism.feedback()` mirrors it →
  `/api/feedback`.

### 1.3 Human scores already have a home
- `POST /api/evaluations/scores` writes `eval_scores` with `scorer_type='human'`, `judge_model`,
  `score`, `reason`, `trace_id`, `span_id` behind a `canWriteOrg` gate. ⇒ **Reviewer submissions land
  in `eval_scores` (no new score store)**; only end-user thumbs need the new `feedback` table.

### 1.4 Queue trigger already computed
- `is_edge = score < 0.7` is computed by the judge (`lib/engine/validator.ts`) and the PRD-1 sampler.
  ⇒ The annotation queue is **populated by the PRD-1 sampler** (edge / low-confidence / disagreement)
  + a manual "send to queue" action.

### 1.5 Reviewer context + access gate exist
- Conversation arc = `request_logs` (PRD-0) + `trace_tree`. Viewing prompt content is governed by the
  existing `log_access_requests` gate (`can_manage_project` / approved row). Detail pages:
  `app/dashboard/sessions/[id]/page.tsx`, `app/dashboard/projects/[id]/observability/{sessions,traces}`.

---

## 2. Design summary
1. **`feedback`** table for end-user thumbs/score/comment (key-authed ingest, dual-write like outcomes).
2. **`annotation_queue`** table populated by the PRD-1 sampler + manual enqueue; reviewer UI claims →
   submits a human score to `eval_scores` and marks the item done.
3. **Reviewer workspace** reuses PRD-0 payloads + the trace tree + the log-access gate.
4. **Export** selected annotations → `evaluation_datasets`/`eval_dataset_items` (PRD-2).
5. **Loop closure:** human scores in `eval_scores` feed PRD-1's judge↔human agreement metric.

## 3. Data model & migrations
Migration `supabase/migrations/20260617090000_feedback_annotation.sql`:
```sql
CREATE TABLE public.feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key_id  uuid REFERENCES public.api_keys(id) ON DELETE SET NULL,
  source      text NOT NULL DEFAULT 'end_user' CHECK (source IN ('end_user','reviewer')),
  trace_id    text,
  span_id     text,
  session_id  text,
  value       numeric,            -- thumbs: 1 / 0 ; or 0..1 score
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY fb_select ON public.feedback FOR SELECT USING (public.is_org_member(org_id));
-- writes are service-role (key-authed route) — no user INSERT policy, matching outcome_events
CREATE INDEX idx_feedback_org   ON public.feedback(org_id, created_at DESC);
CREATE INDEX idx_feedback_trace ON public.feedback(trace_id);

CREATE TABLE public.annotation_queue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  trace_id    text,
  span_id     text,
  eval_run_id uuid REFERENCES public.evaluation_runs(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_review','done','skipped')),
  priority    int  NOT NULL DEFAULT 0,
  reason      text,                -- 'edge' | 'judge_disagreement' | 'low_confidence' | 'sampled' | 'manual'
  assignee    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.annotation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY aq_select ON public.annotation_queue FOR SELECT USING (public.is_org_member(org_id));
CREATE POLICY aq_write  ON public.annotation_queue FOR ALL
  USING (public.can_write_org(org_id)) WITH CHECK (public.can_write_org(org_id));
CREATE INDEX idx_aq_org_status ON public.annotation_queue(org_id, status, priority DESC);
CREATE TRIGGER annotation_queue_updated_at BEFORE UPDATE ON public.annotation_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```
- Optional Tinybird mirror `feedback_events` for thumbs aggregation at scale (LOCKED-consistent with
  the outcomes/eval mirror pattern).

## 4. Code changes (file-by-file)
### 4.1 Feedback ingest — `app/api/feedback/route.ts` (new; clone of `outcomes/route.ts`)
- Bearer-key auth + zod + single/batch envelope; dual-write `feedback` (+ Tinybird mirror).
  Schema: `{ trace_id, span_id?, session_id?, value, comment?, project_id? }`.

### 4.2 SDK — `prism.feedback()` (TS + Python parity)
- TS: add to the client + `EventTracker` a `feedback()` that posts to `/api/feedback` (mirror
  `recordOutcome()` at `tracker.ts:332`). Python mirror in `_tracker.py`/`_client.py`.

### 4.3 Queue population — extend the PRD-1 sampler (`app/api/cron/run-online-evals`)
- When a score is `is_edge` / low-confidence / judge-disagreement, insert an `annotation_queue` row
  (`reason`, `priority`). Add a manual `POST /api/annotations/queue` "send to queue" too.

### 4.4 Annotation API — `app/api/annotations/queue/route.ts` (+ `[id]`) (new)
- `GET` (list, prioritized), `POST` (manual enqueue), `PUT /[id]` (claim/submit/skip). On submit:
  write a human score via the existing `recordScores()` helper (`scorer_type='human'`) **and** set
  status `done`. All gated by `canWriteOrg` (read_only blocked).

### 4.5 Export to datasets — `app/api/annotations/export/route.ts` (new)
- Turn selected annotations into `evaluation_datasets` + `eval_dataset_items` (PRD-2 tables).

### 4.6 Reviewer context — reuse PRD-0 `GET /api/content/[eventId]` + `trace_tree`, gated by
  `log_access_requests`.

## 5. UX
- **Annotation queue** page (new `app/dashboard/quality/annotations/page.tsx`): prioritized list,
  claim, filters by reason/status.
- **Reviewer workspace**: conversation arc (PRD-0 payloads) + span tree + score/comment form
  (writes `eval_scores` human) + accept/reject.
- **Feedback widgets** embedded in `sessions/[id]` + `observability/traces` detail.
- **Thumbs aggregation** surfaced to Product (per feature) via the `feedback`/mirror query.

## 6. Phased tasks → files (each gated by `tsc`/`build`)
- **P3.1** Migration (`feedback`, `annotation_queue`) + types. *AC:* tables + RLS.
- **P3.2** `/api/feedback` + SDK `feedback()` (TS+Py). *AC:* `prism.feedback()` lands a row linked to a trace.
- **P3.3** Sampler enqueues edge cases + `/api/annotations/queue`. *AC:* edge cases auto-appear in the queue.
- **P3.4** Reviewer UI with context + submit→`eval_scores` human. *AC:* a reviewer scores an item; status→done; `read_only` blocked.
- **P3.5** Span-level annotation + export to datasets. *AC:* selected annotations become a PRD-2 dataset.

## 7. Locked-decision alignment + small choices
- **Inherits PRD-0/PRD-1 locks** (Supabase-first storage; Tinybird mirror for aggregation; gateway
  self-metering — N/A here).
- **Queue population — recommend:** inside the PRD-1 sampler (it already computes `is_edge`) + a manual
  enqueue action.
- **End-user feedback auth — recommend:** key-scoped (like outcomes); a public widget token is a
  later add-on.

## 8. Risks
- **Reviewer bottleneck** → priority-ordered queue (worst/edge first).
- **Feedback spam/abuse** → key-scoping + ingest rate limit (reuse `ingestRatelimit`).
- **PII in comments** → mask via the PRD-0 masker before storage.

## 9. Test plan
- **Unit:** `/api/feedback` validation + dual-write; queue claim/submit writes a human `eval_score`;
  `read_only` blocked on queue write.
- **Integration:** sampler enqueues an edge case → reviewer submits → `eval_scores(human)` row + queue
  `done`; export builds a dataset.
- **E2E:** `prism.feedback()` from SDK → row visible; thumbs aggregate per feature; judge↔human
  agreement computable (closes PRD-1 loop).
- **Gates:** `tsc`/`lint`/`build`; SDK TS `vitest` + Python `pytest`.
