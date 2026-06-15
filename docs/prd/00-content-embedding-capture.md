# PRD-0 — Content & Embedding Capture (Keystone)

> **Phase:** 0 (Foundation) · **Status:** Draft for review · **Depends on:** none ·
> **Enables:** PRD-1 (RAG scorers), PRD-3 (reviewer context), PRD-5 (embeddings), PRD-6 (payloads/spans); enriches PRD-7 ·
> **Owner:** TBD · **Part of:** [Quality & Intelligence Roadmap](../strategy/quality-intelligence-roadmap.md)

## 1. Summary & problem
Prism captures rich **metadata** for every LLM call but **no content** — no prompt/completion text,
no retrieved RAG context, no tool inputs/outputs — and **no embeddings**. Four high-value
capabilities are impossible without that substrate: deep tracing/debugging (PRD-6), RAG &
hallucination quality (PRD-1), drift & embeddings analysis (PRD-5), and rich human annotation
(PRD-3). This PRD adds an **opt-in, PII-scoped content & embedding capture layer** keyed to existing
events/traces/spans. It is the keystone the rest of the suite builds on, and a chance to **lead on
privacy** (opt-in, redacted, residency-aware) versus competitors that store raw payloads by default.

## 2. Current state (code anchors)
- `tinybird/datasources/llm_events.datasource` — captures tokens, cost, latency, `ttft_ms`,
  `status_code`, full `trace_id`/`span_id`/`parent_span_id`/`session_id`, `tags Map(String,String)`,
  `attributes String` (JSON), `ttl_days`. **No content fields.**
- Ingest: `apps/web/app/api/ingest/route.ts` (SDK) and `apps/web/app/api/otel/v1/traces/route.ts`
  (OTLP/JSON) → `apps/web/lib/otel/mapper.ts` maps only `gen_ai.*`/`llm.*` spans to events and
  **drops all other spans** (counted as `skipped`). `ingestToTinybird()` in `lib/tinybird/client.ts`.
- Gateway log path (`app/api/gateway/[provider]/[[...path]]/route.ts`) ships events to Tinybird.
- PII: `lib/gateway/guardrails/` (detector + masker) and `tinybird/datasources/pii_incidents.datasource` — **reuse for redaction.**
- Retention: `planToTtlDays()` in `lib/pricing/table.ts`. Residency: `org.data_residency_policy` +
  `lib/gateway/data-residency.ts`.

## 3. Competitive context
Langfuse, LangSmith, Arize, and Braintrust all store full I/O + retrieval context as the basis for
trace inspection and evaluation — it is table stakes for any quality feature. We store metadata only.
Closing this reaches parity; doing it **privacy-first** (opt-in, inline-redacted, TTL'd,
residency-aware, RBAC-gated) is a differentiator for regulated buyers.
*Sources: [Arize tracing](https://arize.com/docs/phoenix/evaluation/llm-evals), [Langfuse](https://langfuse.com/).*

## 4. Goals / Non-goals
**Goals:** capture prompt/completion/context/tool-IO; optional embeddings; per-project opt-in with
redaction; payload TTL + residency; a payload viewer; zero regression to the existing metadata path.
**Non-goals:** the eval scorers (PRD-1), drift math (PRD-5), full debug UI (PRD-6 extends the viewer),
fine-tune export (PRD-3/later).

## 5. Division value
- **Engineering** — see the *actual* prompt/response/tool-IO when debugging.
- **Data Science** — the substrate for drift (PRD-5) and dataset curation (PRD-2/PRD-3).
- **Product** — read real conversations for quality/topic review.
- **Compliance** — controlled, redacted, auditable capture is a sales-grade control, not a liability.

## 6. Functional requirements
- **Opt-in per project** (default off). Levels: `off` → `metadata_only` (today) → `redacted_content`
  → `full_content`.
- **Capture surfaces:** SDK (analytics mode), gateway (inline), OTEL mapper (`gen_ai.prompt`/
  `gen_ai.completion` + retained retrieval/tool spans).
- **Redaction inline** via the existing PII masker *before* persistence; store a redaction count, never
  raw PII at `redacted_content`.
- **Retention:** payload TTL configurable and independent of (≤) the metadata `ttl_days`.
- **Residency:** route payload storage per `org.data_residency_policy`.
- **Embeddings:** optional; computed on capture (configurable model) or accepted from the SDK; linked
  to event/trace/span.
- **Linkage:** every payload/embedding keyed by `event_id` + `trace_id` + `span_id` + `org_id` +
  `project_id`.

## 7. Data model
- **Payloads (blobs):** object storage (R2/S3) referenced by key (cheap, large, lifecycle-TTL) +
  a lightweight index. *Alternative:* a short-TTL Tinybird DS `llm_event_payloads`. **Recommended:**
  object storage + index for cost/size control.
- **Supabase `content_captures`** (index): `event_id, trace_id, span_id, org_id, project_id,
  role ∈ {prompt,completion,context,tool_input,tool_output}, storage_ref, redaction_level,
  pii_found int, byte_size, created_at, expires_at`.
- **Embeddings:** `pgvector` table `content_embeddings (event_id, kind, vector, model, created_at)`
  (Supabase already present → simplest) *or* a managed vector store (open question §13).
- **Supabase `content_capture_settings`:** `org_id, project_id, level, redaction_level,
  payload_ttl_days, embed_enabled, embed_model, residency_override`.
- **OTEL mapper:** add `span_kind` retention for tool/retrieval spans (flows into PRD-6).

## 8. API & SDK surface (TS + Python parity)
- **SDK:** `capturePayloads: 'off'|'redacted'|'full'`, `captureEmbeddings`, optional `redact` hook;
  payloads sent in a separate ingest field, gated by the project setting.
- **Ingest:** `/api/ingest` + `/api/otel/v1/traces` accept optional payload fields → redact → store.
- **Routes:** `GET /api/content/[eventId]` (RBAC + project-scope + reuse the **log-access** gate);
  `GET/PUT /api/settings/content-capture` (`canManage`).
- **Gateway:** capture inline when in gateway mode.

## 9. UX / dashboard pages
- **Trace/session detail** (extends `trace_tree` UI, PRD-6): payload viewer panel
  (prompt/response/context/tool-IO) with redaction badges.
- **Settings → Compliance:** per-project content-capture controls (level, TTL, residency,
  embeddings) with a privacy explainer + audit link.

## 10. Phased task breakdown + acceptance criteria
- **P0.1 Storage + schema** — content store, `content_captures`, `content_capture_settings`,
  pgvector, migration. *AC:* settings CRUD works; blob round-trips with TTL.
- **P0.2 Capture path** — SDK opt-in; ingest + OTEL accept payloads; gateway inline; retain
  tool/retrieval spans. *AC:* opted-in project shows payloads on new traces; opted-out stores nothing.
- **P0.3 Redaction + retention + residency** — PII masker inline; payload TTL; residency routing.
  *AC:* compliance audit finds 0 raw PII at `redacted_content`; payloads expire on TTL; residency honored.
- **P0.4 Viewer + settings UI.** *AC:* trace detail shows redacted payloads; settings toggles capture.

## 11. Dependencies
None (foundation). **Enables** PRD-1 (RAG context), PRD-3 (reviewer context), PRD-5 (embeddings),
PRD-6 (payloads/spans); **enriches** PRD-7.

## 12. Success metrics / KPIs
% of traces with captured payloads (opted-in projects); redaction coverage; **zero raw-PII findings**
in compliance audit; payload storage $ / 1k events; embedding coverage %.

## 13. Risks & open questions
- **Privacy/compliance** (storing content is sensitive) → opt-in + inline redaction + TTL + residency
  + RBAC/log-access gate.
- **Cost/volume** (payloads are large) → object storage + short TTL + sampling.
- **Open: vector store** — pgvector vs managed (recommend pgvector to start).
- **Open: payload store** — object storage + index vs all-in-Tinybird DS (recommend object storage).
- **Throughput** — redact before persist (no raw-at-rest); push 'full' redaction to the edge/SDK where
  the customer opts out of server redaction.

## 14. Out of scope (code-analysis doc to follow)
Exact migration SQL, object-storage provider + bucket/lifecycle config, pgvector setup, `mapper.ts`
diff, SDK field names, and tests — covered in the PRD-0 code-analysis doc after approval.
