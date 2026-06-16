/**
 * Session-less model execution (PRD-2).
 *
 * The Arena chat route (app/api/arena/chat/route.ts) executes a model behind
 * requireAuth() — a browser session. The offline-eval experiment runner and the
 * CI helper have NO session (they authenticate with a Prism API key, or run in a
 * background job), so they cannot call that route server-to-server.
 *
 * This module extracts the provider-dispatch core into a pure function that
 * takes an already-resolved orgId + provider_key_id and returns the completion
 * plus usage/cost — the same capability the Arena route exposes, minus the SSE
 * streaming and the cookie auth. Non-streaming only (the runner scores whole
 * completions; it never needs token-by-token streaming).
 *
 * Design: docs/implementation/02-offline-evals-datasets-experiments.impl.md §4.1
 */
import { decryptKey } from "@/lib/crypto/keys";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { calculateCost, planToTtlDays, MODEL_PRICING, normalizeModelName } from "@/lib/pricing/table";
import { v4 as uuidv4 } from "uuid";

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai:       "https://api.openai.com/v1/chat/completions",
  anthropic:    "https://api.anthropic.com/v1/messages",
  azure_openai: "", // built dynamically from azure_endpoint
  google:       "https://generativelanguage.googleapis.com/v1beta/models",
};

export interface ExecuteParams {
  orgId:         string;
  providerKeyId: string;
  model:         string;
  messages:      { role: string; content: string }[];
  /** Optional generation params merged into the upstream body (temperature, max_tokens, top_p…). */
  params?:       Record<string, unknown>;
  /** Ship a Tinybird llm_event (environment="experiment") so experiment spend shows in analytics. Default true. */
  capture?:      boolean;
  /** Group calls of one experiment under a trace id (optional). */
  traceId?:      string;
}

export interface ExecuteResult {
  ok:           boolean;
  completion:   string;
  inputTokens:  number;
  outputTokens: number;
  cachedTokens: number;
  costUsd:      number;
  latencyMs:    number;
  error?:       string;
}

/** The provider that serves a model, via the shared pricing table (handles versioned ids). */
export function providerForModel(model: string): string | null {
  const entry = MODEL_PRICING[normalizeModelName(model)];
  return entry?.provider ?? null;
}

/**
 * Resolve a provider key to execute `model` with: the explicit id if given and
 * valid for the org, otherwise the org's first active key for the model's
 * provider. Returns null when nothing matches (caller surfaces a clear error).
 */
export async function resolveProviderKey(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin:   any,
  orgId:   string,
  model:   string,
  explicit?: string | null,
): Promise<string | null> {
  if (explicit) {
    const { data } = await admin
      .from("provider_keys")
      .select("id")
      .eq("id", explicit)
      .eq("org_id", orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  const provider = providerForModel(model);
  if (!provider) return null;
  const { data } = await admin
    .from("provider_keys")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", provider)
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Pull the assistant text out of a provider's non-streaming response shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseCompletion(provider: string, data: any): string {
  if (provider === "anthropic")  return data?.content?.[0]?.text ?? "";
  if (provider === "google")     return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  // openai + azure_openai (and any openai-compatible)
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Normalize usage across providers → { input, output, cached } tokens. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseUsage(provider: string, data: any): { input: number; output: number; cached: number } {
  if (provider === "google") {
    const u = data?.usageMetadata ?? {};
    return { input: u.promptTokenCount ?? 0, output: u.candidatesTokenCount ?? 0, cached: u.cachedContentTokenCount ?? 0 };
  }
  const u = data?.usage ?? {};
  return {
    input:  u.input_tokens  ?? u.prompt_tokens     ?? 0,
    output: u.output_tokens ?? u.completion_tokens ?? 0,
    cached: u.cache_read_input_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0,
  };
}

/**
 * Execute one non-streaming model call using the org's stored provider key.
 * Never throws — failures resolve to { ok:false, error } so the runner can
 * record a 0-score sample and keep going.
 */
export async function executeModelCall(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin:  any,
  params: ExecuteParams,
): Promise<ExecuteResult> {
  const t0 = Date.now();
  const fail = (error: string): ExecuteResult => ({
    ok: false, completion: "", inputTokens: 0, outputTokens: 0, cachedTokens: 0,
    costUsd: 0, latencyMs: Date.now() - t0, error,
  });

  try {
    const { data: pk } = await admin
      .from("provider_keys")
      .select("id, provider, key_encrypted, azure_endpoint, organizations(plan)")
      .eq("id", params.providerKeyId)
      .eq("org_id", params.orgId)
      .eq("is_active", true)
      .maybeSingle();
    if (!pk) return fail("provider key not found");

    const provider    = pk.provider as string;
    const providerKey = decryptKey(pk.key_encrypted as string);
    const orgPlan     = (pk.organizations as { plan?: string } | null)?.plan ?? "starter";
    const extra       = params.params ?? {};

    // ── Build upstream request (mirrors app/api/arena/chat/route.ts) ──────────
    let upstreamUrl  = PROVIDER_ENDPOINTS[provider] ?? PROVIDER_ENDPOINTS.openai;
    let upstreamBody: unknown = { model: params.model, messages: params.messages, stream: false, ...extra };
    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (provider === "anthropic") {
      headers["x-api-key"]         = providerKey;
      headers["anthropic-version"] = "2023-06-01";
      const sys  = params.messages.find(m => m.role === "system");
      const chat = params.messages.filter(m => m.role !== "system");
      if (chat.length === 0) return fail("anthropic requires a non-system message");
      upstreamBody = { model: params.model, messages: chat, max_tokens: 4096, stream: false, ...(sys ? { system: sys.content } : {}), ...extra };
    } else if (provider === "azure_openai") {
      const azureEndpoint = pk.azure_endpoint as string;
      upstreamUrl  = `${azureEndpoint}/openai/deployments/${params.model}/chat/completions?api-version=2024-02-01`;
      headers["api-key"] = providerKey;
    } else if (provider === "google") {
      upstreamUrl  = `${PROVIDER_ENDPOINTS.google}/${params.model}:generateContent?key=${providerKey}`;
      upstreamBody = {
        contents: params.messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      };
    } else {
      headers["Authorization"] = `Bearer ${providerKey}`;
    }

    const upstream = await fetch(upstreamUrl, { method: "POST", headers, body: JSON.stringify(upstreamBody) });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => "");
      return fail(`provider error ${upstream.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data       = await upstream.json() as any;
    const completion = parseCompletion(provider, data);
    const usage      = parseUsage(provider, data);
    const costUsd    = calculateCost(params.model, usage.input, usage.output, usage.cached);
    const latencyMs  = Date.now() - t0;

    if (params.capture !== false) {
      const spanId = params.traceId ? uuidv4().replace(/-/g, "") : "";
      await ingestToTinybird([{
        event_id:      uuidv4(),
        timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
        org_id:        params.orgId,
        project_id:    "", project_name: "", team_id: "", user_id: "",
        environment:   "experiment",
        provider,      model: params.model,
        input_tokens:  usage.input,
        output_tokens: usage.output,
        cached_tokens: usage.cached,
        image_tokens:  0, audio_tokens: 0, text_tokens: usage.input, modalities: "text",
        cost_usd:      costUsd,
        latency_ms:    latencyMs,
        status_code:   200,
        request_id:    data?.id ?? uuidv4(),
        api_key_id:    "",
        tags:          { source: "experiment" },
        ttl_days:      planToTtlDays(orgPlan),
        ...(params.traceId ? { trace_id: params.traceId, span_id: spanId, parent_span_id: "" } : {}),
      }]).catch(() => {});
    }

    return {
      ok: true, completion,
      inputTokens: usage.input, outputTokens: usage.output, cachedTokens: usage.cached,
      costUsd, latencyMs,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
