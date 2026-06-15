# Code-Analysis / Implementation Design — PRD-6: Deep Tracing & Debugging

> **Implements:** [PRD-6](../prd/06-deep-tracing-debugging.md) · **Phase:** 3 (Advanced) ·
> **Status:** Implementation design for review (no code yet) · **Critical-path position:** #6 ·
> **Depends on:** PRD-0 (payloads + span retention); complements existing `agent_loop_detection`.

## 0. How to read this doc
Engineering design behind PRD-6. The **multi-kind trace tree already exists**; the core work is
**retaining non-LLM spans** (which the OTEL mapper currently drops) plus a waterfall UI, payload
panel, error clustering, and replay.

---

## 1. Current-state analysis (corrected by code reading)
### 1.1 The trace tree already supports multiple span kinds
- `tinybird/pipes/trace_tree.pipe` **UNIONs** `llm_events` (`span_kind='llm'`) + `mcp_tool_events`
  (`span_kind='tool'`) into one ordered span list (`span_kind, service, operation, cost_usd,
  latency_ms, status`). ⇒ The waterfall data shape exists; we add a third source.

### 1.2 The OTEL mapper drops everything non-LLM
- `apps/web/lib/otel/mapper.ts` — `isLlmSpan()` (`:82`) keeps only spans with `gen_ai.*`/`llm.*`;
  all other spans hit `skipped++` (`:189`). Non-gen_ai attributes are already collected as `otel.*`
  tags (`:130`). ⇒ Retrieval/tool/custom spans are **never stored** → can't be shown.

### 1.3 Trace rollup + loop detection exist
- `traces` table (`…180000:18`) + `upsertTraceRollup()` (`lib/gateway/trace-writer.ts`) roll up cost/
  status/timing per trace. `tinybird/pipes/agent_loop_detection.pipe` already flags repeated tool
  loops. `/api/traces` + `/api/traces/[traceId]`. Detail UI:
  `app/dashboard/projects/[id]/observability/traces/page.tsx`.

### 1.4 Payloads come from PRD-0
- Per-span inputs/outputs = PRD-0 `request_logs`/content, gated by `log_access_requests`.

---

## 2. Design summary
1. **New `spans` Tinybird datasource** for non-LLM spans (keeps `llm_events` clean of token/cost-less
   rows).
2. **Extend the OTEL mapper** to map non-LLM spans → `spans` (instead of dropping) — *this is the same
   span-retention work PRD-0 flagged; PRD-6 owns it.*
3. **Extend `trace_tree`** with a third UNION branch from `spans`.
4. **Waterfall UI** + **payload detail panel** (PRD-0) + **error clustering** pipe + **replay** via
   `/api/arena/chat` (PRD-4).

## 3. Data model & changes
New Tinybird datasource `tinybird/datasources/spans.datasource`:
```
SCHEMA >
  `span_id`        String        `json:$.span_id`,
  `trace_id`       String        `json:$.trace_id`,
  `parent_span_id` String        `json:$.parent_span_id`,
  `org_id`         String        `json:$.org_id`,
  `project_id`     String        `json:$.project_id`,
  `span_kind`      LowCardinality(String) `json:$.span_kind`,  -- retrieval|tool|chain|custom
  `name`           String        `json:$.name`,
  `service`        String        `json:$.service`,
  `start_ts`       DateTime64(3) `json:$.start_ts`,
  `latency_ms`     UInt32        `json:$.latency_ms`,
  `status`         LowCardinality(String) `json:$.status`,     -- ok|error
  `attributes`     String        `json:$.attributes`,          -- JSON (otel.* + error)
  `ttl_days`       UInt16        `json:$.ttl_days`
ENGINE "MergeTree"
ENGINE_PARTITION_KEY "toYYYYMM(start_ts)"
ENGINE_SORTING_KEY "org_id, trace_id, start_ts"
ENGINE_TTL "toDateTime(start_ts) + INTERVAL ttl_days DAY"
```
- **`trace_tree.pipe`**: add a third `UNION ALL` selecting from `spans` (mapping `name→operation`,
  `status→status_str`, `0 AS cost_usd`).
- New pipe `tinybird/pipes/error_clusters.pipe`: group `llm_events` (status_code≠200) + `spans`
  (status='error') by error signature (from `attributes`/status) with counts + last-seen.

## 4. Code changes (file-by-file)
### 4.1 OTEL mapper — `apps/web/lib/otel/mapper.ts`
- Return non-LLM spans too: for spans failing `isLlmSpan`, build a `SpanLike` (kind from
  `gen_ai.operation`/`openinference.span.kind`/heuristics: retrieval/tool/chain) and emit to a second
  array. `app/api/otel/v1/traces/route.ts` writes LLM spans → `llm_events`, other spans →
  `ingestToTinybird(spans, "spans")`.

### 4.2 SDK span helpers (TS + Python)
- Optional manual spans (`prism.span(name, kind, fn)`) for custom steps, attached to the current trace
  context (`src/trace.ts` already tracks trace/span ids).

### 4.3 Trace API — `/api/traces/[traceId]`
- Enrich with the `spans` branch + per-span payload pointers (PRD-0).

### 4.4 Replay — reuse `/api/arena/chat` (PRD-4)
- "Replay" loads a span's input payload (PRD-0) and re-runs it against a chosen model in the playground
  (read-only; sandboxed).

## 5. UX
- **Trace waterfall** + **span detail panel** (extend the traces detail page): timing waterfall,
  per-span inputs/outputs (PRD-0, redacted), tokens/cost, errors.
- **Error explorer** (clusters) page.
- **Replay** button on a span.

## 6. Phased task breakdown → files (each gated by `tsc`/`build`)
- **P6.1** `spans` DS + OTEL mapper retention + `trace_tree` third branch. *AC:* a trace with retrieval/tool spans renders all spans.
- **P6.2** Waterfall UI. *AC:* multi-step trace shows a timed waterfall.
- **P6.3** Payload/detail panel (PRD-0). *AC:* per-span inputs/outputs (redacted) visible to authorized users.
- **P6.4** `error_clusters` pipe + explorer. *AC:* failing spans grouped by signature.
- **P6.5** Replay. *AC:* a span re-runs against a chosen model.

## 7. Locked-decision alignment + small choices
- Inherits PRD-0/1 locks (payloads in Supabase; redaction; log-access gate).
- **Span storage — recommend:** a dedicated Tinybird `spans` DS (keeps `llm_events` clean) added to
  `trace_tree`, rather than overloading `llm_events`.
- **Span-retention ownership:** PRD-6 owns the mapper change; PRD-0 only flagged it (coordinate so it
  lands once).

## 8. Risks
- **Span volume/cost** → `ttl_days` on the `spans` DS + sampling.
- **OTEL convention variance** (LangChain vs OpenLLMetry vs OpenInference) → normalize span-kind in the
  mapper; default unknown→`custom`.
- **Replay side effects** → read-only re-run via arena (no tool execution).

## 9. Test plan
- **Unit:** mapper emits non-LLM spans with correct `span_kind`; `trace_tree` includes them; error
  clustering groups by signature.
- **Integration:** post an OTLP trace with retrieval+tool+LLM spans → all appear in the tree; payload
  panel shows redacted content for a manager.
- **E2E:** debug an agent trace end-to-end (waterfall → span detail → replay).
- **Gates:** `tsc`/`lint`/`build`; SDK TS `vitest` + Python `pytest` for span helpers.
