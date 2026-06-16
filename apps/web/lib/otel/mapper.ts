/**
 * Maps OTLP trace spans to Prism LLMEvent format.
 *
 * Only spans with gen_ai.* attributes are treated as LLM events;
 * infrastructure spans are filtered out and counted as "skipped".
 *
 * GenAI semantic conventions:
 *   gen_ai.system             → provider
 *   gen_ai.request.model      → model
 *   gen_ai.usage.input_tokens → input_tokens (also prompt_tokens)
 *   gen_ai.usage.output_tokens→ output_tokens (also completion_tokens)
 *   gen_ai.usage.cache_read_input_tokens → cached_tokens
 *   http.response.status_code → status_code
 *   service.name (resource)   → project_id
 */

import { calculateCost } from "@/lib/pricing/table";
import { v4 as uuidv4 } from "uuid";
import type { OtlpTracesPayload, OtlpSpan, KeyValue, AnyValue } from "./types";

// ── Attribute helpers ────────────────────────────────────────────────────────

function resolveAnyValue(av: AnyValue): string | number | boolean | null {
  if (av.stringValue !== undefined) return av.stringValue;
  if (av.intValue    !== undefined) return typeof av.intValue === "string" ? parseInt(av.intValue, 10) : av.intValue;
  if (av.doubleValue !== undefined) return av.doubleValue;
  if (av.boolValue   !== undefined) return av.boolValue;
  return null;
}

function buildAttrMap(attrs?: KeyValue[]): Record<string, string | number | boolean | null> {
  if (!attrs) return {};
  return Object.fromEntries(
    attrs.map(kv => [kv.key, resolveAnyValue(kv.value)]),
  );
}

function getStr(attrs: Record<string, unknown>, key: string): string {
  return String(attrs[key] ?? "");
}

function getInt(attrs: Record<string, unknown>, key: string, fallback = 0): number {
  const v = attrs[key];
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : Math.round(n);
}

// ── Span → event ─────────────────────────────────────────────────────────────

export interface LLMEventLike {
  event_id:      string;
  timestamp:     string;
  org_id:        string;
  project_id:    string;
  project_name:  string;
  team_id:       string;
  user_id:       string;
  environment:   string;
  provider:      string;
  model:         string;
  input_tokens:  number;
  output_tokens: number;
  cached_tokens: number;
  image_tokens:  number;
  audio_tokens:  number;
  text_tokens:   number;
  modalities:    string;
  cost_usd:      number;
  latency_ms:    number;
  status_code:   number;
  request_id:    string;
  tags:          Record<string, string>;
  api_key_id:    string;
  key_type:      string;
  ttl_days:      number;
  trace_id:      string;
  span_id:       string;
  parent_span_id: string;
}

export interface SpanLike {
  span_id:        string;
  trace_id:       string;
  parent_span_id: string;
  org_id:         string;
  project_id:     string;
  span_kind:      string;   // retrieval | tool | chain | custom
  name:           string;
  service:        string;
  start_ts:       string;   // "YYYY-MM-DD HH:MM:SS.mmm"
  latency_ms:     number;
  status:         string;   // ok | error
  attributes:     string;   // JSON: span attrs (+ error message on failure)
  ttl_days:       number;
}

function isLlmSpan(attrs: Record<string, unknown>): boolean {
  return (
    "gen_ai.system"        in attrs ||
    "gen_ai.request.model" in attrs ||
    "llm.vendor"           in attrs  // OpenLLMetry compat
  );
}

/** Classify a non-LLM span into a coarse kind for the trace tree / error explorer. */
function classifySpanKind(attrs: Record<string, unknown>, name: string): string {
  const hint = (
    getStr(attrs, "openinference.span.kind") ||
    getStr(attrs, "gen_ai.operation.name")   ||
    getStr(attrs, "traceloop.span.kind")     ||
    ""
  ).toLowerCase();
  const hay = `${hint} ${(name || "").toLowerCase()}`;
  if (/(retriev|embedding|vector|search|rerank)/.test(hay))    return "retrieval";
  if (/(tool|function)/.test(hay) || "tool.name" in attrs || "gen_ai.tool.name" in attrs) return "tool";
  if (/(chain|agent|workflow|graph|pipeline)/.test(hay))       return "chain";
  return "custom";
}

function spanToEvent(
  span:       OtlpSpan,
  spanAttrs:  Record<string, unknown>,
  resourceAttrs: Record<string, unknown>,
  orgId:      string,
  apiKeyId:   string,
  ttlDays:    number,
): LLMEventLike {
  const provider   = getStr(spanAttrs, "gen_ai.system")
    || getStr(spanAttrs, "llm.vendor")
    || "unknown";
  const model      = getStr(spanAttrs, "gen_ai.request.model")
    || getStr(spanAttrs, "llm.request.model")
    || getStr(spanAttrs, "gen_ai.response.model")
    || "unknown";

  const startNs    = BigInt(span.startTimeUnixNano);
  const endNs      = BigInt(span.endTimeUnixNano);
  const latencyMs  = Number((endNs - startNs) / BigInt(1_000_000));
  const timestampMs = Number(startNs / BigInt(1_000_000));
  const timestamp   = new Date(timestampMs).toISOString().replace("T", " ").slice(0, 23);

  const inputTokens  = getInt(spanAttrs, "gen_ai.usage.input_tokens")
    || getInt(spanAttrs, "gen_ai.usage.prompt_tokens")
    || getInt(spanAttrs, "llm.usage.prompt_tokens");
  const outputTokens = getInt(spanAttrs, "gen_ai.usage.output_tokens")
    || getInt(spanAttrs, "gen_ai.usage.completion_tokens")
    || getInt(spanAttrs, "llm.usage.completion_tokens");
  const cachedTokens = getInt(spanAttrs, "gen_ai.usage.cache_read_input_tokens");

  const statusCode   = getInt(spanAttrs, "http.response.status_code", span.status?.code === 2 ? 500 : 200);

  const projectId    = getStr(resourceAttrs, "service.name")
    || getStr(resourceAttrs, "service.namespace")
    || "";

  // Collect remaining span attrs as tags (prefixed with otel.)
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(spanAttrs)) {
    if (k.startsWith("gen_ai.") || k.startsWith("llm.") || k === "http.response.status_code") continue;
    tags[`otel.${k}`] = String(v ?? "");
  }

  const costUsd = calculateCost(model, inputTokens, outputTokens, cachedTokens);

  return {
    event_id:      uuidv4(),
    timestamp,
    org_id:        orgId,
    project_id:    projectId,
    project_name:  projectId,
    team_id:       "",
    user_id:       "",
    environment:   getStr(spanAttrs, "deployment.environment") || "production",
    provider:      provider.toLowerCase(),
    model,
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    cached_tokens: cachedTokens,
    image_tokens:  0,
    audio_tokens:  0,
    text_tokens:   0,
    modalities:    "text",
    cost_usd:      costUsd,
    latency_ms:    Math.max(0, latencyMs),
    status_code:   statusCode,
    request_id:    `${span.traceId.slice(0, 8)}-${span.spanId.slice(0, 8)}`,
    tags,
    api_key_id:    apiKeyId,
    key_type:      "otel",
    ttl_days:      ttlDays,
    trace_id:      span.traceId,
    span_id:       span.spanId,
    parent_span_id: span.parentSpanId ?? "",
  };
}

/** Build a non-LLM span row for the `spans` datasource (retrieval/tool/chain/custom). */
function spanToSpanRow(
  span:          OtlpSpan,
  spanAttrs:     Record<string, unknown>,
  resourceAttrs: Record<string, unknown>,
  orgId:         string,
  ttlDays:       number,
): SpanLike {
  const startNs     = BigInt(span.startTimeUnixNano);
  const endNs       = BigInt(span.endTimeUnixNano);
  const latencyMs   = Number((endNs - startNs) / BigInt(1_000_000));
  const timestampMs = Number(startNs / BigInt(1_000_000));
  const start_ts    = new Date(timestampMs).toISOString().replace("T", " ").slice(0, 23);
  const projectId   = getStr(resourceAttrs, "service.name") || getStr(resourceAttrs, "service.namespace") || "";
  const isError     = span.status?.code === 2;

  const attrObj: Record<string, string> = {};
  for (const [k, v] of Object.entries(spanAttrs)) attrObj[k] = String(v ?? "");
  if (isError && span.status?.message) attrObj.error = String(span.status.message);

  return {
    span_id:        span.spanId,
    trace_id:       span.traceId,
    parent_span_id: span.parentSpanId ?? "",
    org_id:         orgId,
    project_id:     projectId,
    span_kind:      classifySpanKind(spanAttrs, span.name),
    name:           span.name || "span",
    service:        getStr(resourceAttrs, "service.name"),
    start_ts,
    latency_ms:     Math.max(0, latencyMs),
    status:         isError ? "error" : "ok",
    attributes:     JSON.stringify(attrObj).slice(0, 4000),
    ttl_days:       ttlDays,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface MapResult {
  events:  LLMEventLike[];
  spans:   SpanLike[];
  skipped: number;
}

export function mapOtlpToEvents(
  payload:  OtlpTracesPayload,
  orgId:    string,
  apiKeyId: string,
  ttlDays:  number = 30,
): MapResult {
  const events:  LLMEventLike[] = [];
  const spans:   SpanLike[]     = [];
  let   skipped                 = 0;

  for (const rs of payload.resourceSpans ?? []) {
    const resourceAttrs = buildAttrMap(rs.resource?.attributes);

    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        const spanAttrs = buildAttrMap(span.attributes);

        // LLM spans → llm_events; every other span → the spans DS (PRD-6 span
        // retention) rather than being dropped.
        if (!isLlmSpan(spanAttrs)) {
          try {
            spans.push(spanToSpanRow(span, spanAttrs, resourceAttrs, orgId, ttlDays));
          } catch {
            skipped++;
          }
          continue;
        }

        try {
          events.push(spanToEvent(span, spanAttrs, resourceAttrs, orgId, apiKeyId, ttlDays));
        } catch {
          skipped++;
        }
      }
    }
  }

  return { events, spans, skipped };
}
