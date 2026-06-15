# Code-Analysis / Implementation Design — PRD-0: Content & Embedding Capture

> **Implements:** [PRD-0](../prd/00-content-embedding-capture.md) · **Phase:** 0 (Foundation) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #1 ·
> **Companion roadmap:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 0. How to read this doc
This is the **engineering design** behind PRD-0: exact current-state code, the data model + migrations,
file-by-file changes, the PII/retention/residency wiring, a phased task plan with `tsc`/`build`/test
gates, and the **open decisions that need your sign-off** (they propagate to every later doc).

---

## 1. Current-state analysis (corrected by code reading)
The product PRD said "we store metadata only — no payloads." **That is only true for SDK + OTEL
ingest. Gateway mode already captures (PII-masked) prompt + completion.** The real, verified state:

### 1.1 Metadata spine (no content)
- `tinybird/datasources/llm_events.datasource` — tokens/cost/latency/`ttft_ms`, full
  `trace_id`/`span_id`/`parent_span_id`/`session_id`, `tags Map`, `attributes String`. **No content.**
- **SDK ingest** `apps/web/app/api/ingest/route.ts` — `EventSchema` (`:12-41`) has **no content
  fields**; events are sanitised (`:304-317`) and sent via `ingestToTinybird()` (`:381`).
- **OTEL ingest** `apps/web/app/api/otel/v1/traces/route.ts` → `apps/web/lib/otel/mapper.ts` maps
  **only `gen_ai.*`/`llm.*` spans**; retrieval/tool spans are dropped (`skipped`). No content stored.
- **Ingest chokepoint** `apps/web/lib/tinybird/client.ts` → `ingestToTinybird()` (`:56-114`).

### 1.2 Content capture that ALREADY exists (gateway mode only)
- `apps/web/lib/gateway/request-logger.ts` → **`writeRequestLog()` (`:107-141`)** inserts into a
  **Supabase `request_logs`** table: `prompt` (messages JSON), `completion` (text), model, provider,
  tokens, cost, latency, status, `session_id`, git, `trace_id`, `span_id`.
- **Opt-in** per key: gated by `api_keys.prompt_logging_enabled` (per the module header).
- **PII-masked** when `org.pii_masking_enabled`: `getOrgPiiConfig()` (`:41`) →
  `maskMessages()` / `maskPii()` (`:114-117`).
- **Reader / access gate already exists:** `log_access_requests`
  (`supabase/migrations/20260612191000_log_access.sql`) + helpers `can_manage_project(project_id)` /
  `is_org_admin(org_id)` govern who may read a project's prompt logs.

### 1.3 Reusable building blocks
- **PII:** `apps/web/lib/privacy/pii-masker.ts` — `maskPii(text, types)` (`:17`),
  `maskMessages(messages, types)` (`:36`), `PiiPatternType`; `apps/web/lib/privacy/pii-detector.ts` —
  `detectPII()` (`:106`), `scanString()` (`:56`), `CustomPattern`.
- **Residency:** `apps/web/lib/gateway/data-residency.ts` — `checkDataResidency(orgPolicy,
  providerKeyRegion)`; `ResidencyPolicy = any|eu_only|us_only|india_only`, `DataRegion = global|eu|us|in`.
- **Retention:** `planToTtlDays()` in `lib/pricing/table.ts`.
- **SDK (TS):** `packages/typescript-sdk/src/types.ts` — `LLMEvent`, `PrismOptions`;
  `src/tracker.ts` — `EventTracker.capture()` (`:172`) and `captureRaw()` (`:266`) **already receive
  `messages` + `response`** but discard content; `hashSystemPrompt()` (`:7`) is precedent for handling
  prompt content; `_sendBatch()` (`:139`) POSTs `{events}` to `/api/ingest`.
- **SDK (Python):** mirror in `packages/python-sdk/prism/{_tracker.py,_config.py,_models.py}`.

### 1.4 Confirmed absent (must be introduced)
- **No `pgvector`** extension in any migration (grep found none) → embeddings need
  `CREATE EXTENSION vector`.
- **No general object storage** — every `@aws-sdk` reference is Bedrock (guardrails/aws-helpers), not
  blob storage.
- **No** retrieved-context / tool-IO capture, **no** embeddings, **no** payload TTL, **no**
  per-project capture settings (only the per-key `prompt_logging_enabled` boolean + per-org PII).

### 1.5 Migration conventions (to follow)
From `20260612191000_log_access.sql` and the RBAC foundation: `id uuid PRIMARY KEY DEFAULT
gen_random_uuid()`, `org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE`,
`created_at timestamptz NOT NULL DEFAULT now()`, `ENABLE ROW LEVEL SECURITY`, policies built from
`is_org_admin(org_id)`, `can_manage_project(project_id)`, `can_read_project(project_id)`, `auth.uid()`.

---

## 2. Design summary (what we build)
1. **Generalize the existing content store** rather than inventing a new one: keep `request_logs` as
   the **unified content table**, add `context`, `tool_io`, redaction metadata, and `expires_at`; have
   **SDK and OTEL paths write to it too** (today only the gateway does).
2. **Extend capture to all three ingest paths** (SDK, gateway, OTEL) behind one `content_capture_settings`.
3. **Add embeddings** via a new `content_embeddings` (pgvector) table, computed through Prism's own
   gateway (dogfood) — async, never inline.
4. **Add retention + residency**: `expires_at` + a purge cron; residency routing (with a documented
   v1 limitation — see §7).
5. **Reader** reuses the `log_access_requests` gate; **viewer** panel + settings UI.

---

## 3. Data model & migrations
New migration `supabase/migrations/20260615090000_content_capture.sql`:

```sql
-- 1. Embeddings need pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Generalize request_logs into the unified content store
ALTER TABLE public.request_logs
  ADD COLUMN IF NOT EXISTS context         jsonb,          -- retrieved RAG docs / chunks
  ADD COLUMN IF NOT EXISTS tool_io         jsonb,          -- tool call inputs/outputs
  ADD COLUMN IF NOT EXISTS redaction_level text NOT NULL DEFAULT 'none'
        CHECK (redaction_level IN ('none','redacted','dropped')),
  ADD COLUMN IF NOT EXISTS pii_found       int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source          text NOT NULL DEFAULT 'gateway'
        CHECK (source IN ('gateway','sdk','otel')),
  ADD COLUMN IF NOT EXISTS event_id        text,           -- ties to llm_events.event_id
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz;    -- retention TTL

CREATE INDEX IF NOT EXISTS idx_request_logs_event   ON public.request_logs(event_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_expires ON public.request_logs(expires_at);

-- 3. Per-project capture settings (supersedes per-key prompt_logging_enabled; back-compat kept)
CREATE TABLE public.content_capture_settings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id       uuid REFERENCES public.projects(id) ON DELETE CASCADE,  -- null = org default
  level            text NOT NULL DEFAULT 'off'
                   CHECK (level IN ('off','metadata_only','redacted_content','full_content')),
  payload_ttl_days int  NOT NULL DEFAULT 30,
  embed_enabled    boolean NOT NULL DEFAULT false,
  embed_model      text,
  residency_override text,
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, project_id)
);
ALTER TABLE public.content_capture_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccs_select ON public.content_capture_settings FOR SELECT
  USING (public.is_org_member(org_id));
CREATE POLICY ccs_write ON public.content_capture_settings FOR ALL
  USING      (public.is_org_admin(org_id) OR public.can_manage_project(project_id))
  WITH CHECK (public.is_org_admin(org_id) OR public.can_manage_project(project_id));

-- 4. Embeddings
CREATE TABLE public.content_embeddings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  event_id   text NOT NULL,
  trace_id   text,
  span_id    text,
  kind       text NOT NULL CHECK (kind IN ('prompt','completion')),
  embedding  vector(1536),       -- dim set by chosen model (see §7 open decision)
  model      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY ce_select ON public.content_embeddings FOR SELECT USING (public.is_org_member(org_id));
CREATE INDEX idx_content_embeddings_event ON public.content_embeddings(event_id);
-- (ivfflat/hnsw index added in PRD-5 when drift queries land)
```
*Apply mechanics unchanged: pg runner against the `aws-1-ap-southeast-2` pooler, then
`supabase migration repair`. Regenerate `database.types.ts` after.*

> **Storage note:** v1 keeps payloads in Supabase `request_logs` (reuses what exists; fine for
> moderate volume). For high volume, Phase-2 moves large blobs to **object storage** with a pointer
> column — see §7 open decision.

---

## 4. Code changes (file-by-file)

### 4.1 Shared content writer — `apps/web/lib/content/store.ts` (new; refactor of request-logger)
Generalize `writeRequestLog()` into `writeContent(entry)` that all three paths call. It:
- resolves `content_capture_settings` (project → org default; back-compat: treat
  `api_keys.prompt_logging_enabled = true` as `redacted_content`),
- applies PII masking via `getOrgPiiConfig()` + `maskMessages`/`maskPii` (reused as-is),
- sets `redaction_level`, `pii_found`, `source`, `event_id`, and `expires_at = now() +
  payload_ttl_days`,
- inserts into `request_logs`.
`request-logger.ts` becomes a thin wrapper (keeps the gateway call site working).

### 4.2 SDK ingest — `apps/web/app/api/ingest/route.ts`
- Extend `EventSchema` with an optional `payload`:
  ```ts
  payload: z.object({
    prompt:     z.array(z.any()).optional(),
    completion: z.string().optional(),
    context:    z.array(z.any()).optional(),
    tool_io:    z.array(z.any()).optional(),
    pre_redacted: z.boolean().optional(),   // SDK already masked client-side
  }).optional(),
  ```
- After the existing Tinybird ingest (`:381`), for each event with `payload` call `writeContent()`
  (fire-and-forget, like `writeLog`) — server-side masking unless `pre_redacted`.

### 4.3 OTEL mapper — `apps/web/lib/otel/mapper.ts` + `app/api/otel/v1/traces/route.ts`
- Extract `gen_ai.prompt.*` / `gen_ai.completion.*` (and retrieval/tool spans) into a `payload`, then
  `writeContent({ source: 'otel' })`.
- **Retain tool/retrieval spans** (the `span_kind` change that PRD-6 also needs) instead of dropping
  them.

### 4.4 Gateway path — `app/api/gateway/[provider]/[[...path]]/route.ts`
- Already calls `writeRequestLog`; switch to `writeContent` and additionally pass `context`/`tool_io`
  and honor `content_capture_settings` (not just `prompt_logging_enabled`).

### 4.5 Embeddings — `apps/web/lib/content/embeddings.ts` (new) + cron
- `computeEmbeddings(eventIds)` calls an embedding model **through Prism's own gateway** (dogfood;
  self-metered), writes `content_embeddings`.
- Triggered async by `app/api/cron/embed-content/route.ts` (follows existing `app/api/cron/*` pattern),
  gated by `content_capture_settings.embed_enabled`.

### 4.6 Retention purge — `app/api/cron/purge-content/route.ts` (new)
- Deletes `request_logs WHERE expires_at < now()` in batches (or `pg_cron` if preferred).

### 4.7 Viewer + settings APIs
- `GET /api/content/[eventId]` (new) — returns payload; **authorize via the existing log-access gate**
  (`can_manage_project` OR an approved `log_access_requests` row). Reuse the WS2 reader if present.
- `GET/PUT /api/settings/content-capture` (new) — `canManage` only (RBAC: `read_only` blocked, reuse
  `canWriteOrg`/`canManage`).

### 4.8 SDK changes (TS + Python parity)
- **TS** `types.ts`: add to `PrismOptions`:
  ```ts
  capturePayloads?: 'off' | 'redacted' | 'full';   // default 'off'
  captureEmbeddings?: boolean;
  redact?: (text: string) => string;               // optional client-side redactor
  ```
  `tracker.ts`: in `capture()`/`captureRaw()`, when `capturePayloads !== 'off'`, build `payload`
  from `messages` (prompt) + `response` (completion) + detected tool calls (the `allToolCalls`
  already computed at `:207`); apply `redact` if `capturePayloads==='redacted'`; attach to the event.
- **Python**: mirror in `_config.py` (options) + `_tracker.py` (payload build).
- Keep SDK parity rule; no `pricing/table.ts` change here.

---

## 5. UX
- **Trace/session detail**: payload viewer panel (prompt/completion/context/tool-IO) with redaction
  badges — extends the `trace_tree` UI (shared with PRD-6).
- **Settings → Compliance** (`apps/web/app/dashboard/settings/privacy` + `/compliance`): per-project
  content-capture controls (level, TTL, residency, embeddings) + privacy explainer + link to the
  audit log.

---

## 6. Phased tasks → files (each gated by `pnpm --filter web exec tsc --noEmit` + `build`)
- **P0.1 Migration + types** — `20260615090000_content_capture.sql`; regen `database.types.ts`.
  *AC:* tables exist; pgvector enabled; settings row CRUD via SQL.
- **P0.2 Shared writer** — `lib/content/store.ts` (`writeContent`), retrofit `request-logger.ts`.
  *AC:* gateway logging unchanged (regression check); writes set redaction/source/expires_at.
- **P0.3 SDK + OTEL capture** — `EventSchema.payload`, `tracker.ts`/`_tracker.py`, `otel/mapper.ts`
  (+ span retention). *AC:* opted-in SDK call stores content; opted-out stores nothing; OTEL retrieval
  spans retained.
- **P0.4 PII + retention + residency** — masking via `getOrgPiiConfig`; `purge-content` cron;
  residency routing. *AC:* audit shows 0 raw PII at `redacted_content`; expired rows purged.
- **P0.5 Embeddings** — `lib/content/embeddings.ts` + `cron/embed-content`. *AC:* embeddings written
  for opted-in projects; self-spend visible.
- **P0.6 Viewer + settings UI** — `/api/content/[eventId]`, `/api/settings/content-capture`, panels.
  *AC:* reviewer with log-access sees redacted payloads; `read_only` cannot change settings.

---

## 7. Locked decisions (confirmed 2026-06-14 — propagate downstream)
1. **Payload storage backend — LOCKED: v1 extends Supabase `request_logs`** (reuse the existing
   table/writer/masking). Large blobs move to **object storage (Supabase Storage)** only at scale in a
   Phase-2 follow-up.
2. **Data residency — LOCKED: v1 stores a residency indicator and documents the single-region
   (`ap-southeast-2`) limitation.** Full per-region storage (regional buckets) is a Phase-2 follow-up.
3. **Embeddings — LOCKED: computed via Prism's own gateway (self-metered), `vector(1536)` default
   dimension, `embed_model` configurable per project.**
4. **pgvector — LOCKED: enable `CREATE EXTENSION IF NOT EXISTS vector` on the staging Supabase
   project** (part of the §3 migration).

## 8. Risks
- **Privacy/compliance** — opt-in + inline redaction + TTL + log-access gate + RBAC (mitigated by
  reusing existing PII + log-access machinery).
- **Volume/cost** — Supabase row size for large payloads → TTL + (later) object storage.
- **Throughput** — content write + masking is fire-and-forget (never blocks ingest/gateway), matching
  the existing `writeRequestLog`/`writeLog` pattern.

## 9. Test plan
- **Unit:** `writeContent` redaction (PII in → masked out, `pii_found` counted); settings resolution
  (project → org default → back-compat key flag); `read_only` blocked on settings PUT.
- **Integration:** SDK `capturePayloads:'redacted'` → masked content row with `expires_at`; `'off'` →
  no row; OTEL retrieval span retained; purge cron deletes expired rows.
- **E2E:** opted-in project → make a call → payload visible in trace detail to a manager, 403 to a
  non-manager without log access.
- **Gates:** `tsc --noEmit`, `lint`, `build` clean; SDK TS `vitest` + Python `pytest` for the new opts.
