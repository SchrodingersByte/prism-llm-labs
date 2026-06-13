/**
 * Cross-provider request/response normalizer.
 *
 * Uses OpenAI chat completion format as the lingua franca.
 * All requests arrive in OpenAI format; this module translates them
 * to the target provider's native format before forwarding, and
 * translates responses back to OpenAI format for the client.
 *
 * Supported translations:
 *   OpenAI  ↔ Anthropic
 *   OpenAI  ↔ Google Gemini
 *   (same-provider: no-op)
 */

import type { GatewayProvider } from "./upstream";

// ── Shared types ──────────────────────────────────────────────────────────────

interface OAIMessage {
  role:    "system" | "user" | "assistant" | "tool";
  content: string | OAIContentBlock[];
  tool_calls?:     OAIToolCall[];
  tool_call_id?:   string;
  name?:           string;
}

interface OAIContentBlock {
  type:      "text" | "image_url";
  text?:     string;
  image_url?: { url: string; detail?: string };
}

interface OAIToolCall {
  id:       string;
  type:     "function";
  function: { name: string; arguments: string };
}

interface OAITool {
  type:     "function";
  function: { name: string; description?: string; parameters?: unknown };
}

export interface OAIRequest {
  model:          string;
  messages:       OAIMessage[];
  tools?:         OAITool[];
  tool_choice?:   unknown;
  temperature?:   number;
  max_tokens?:    number;
  stream?:        boolean;
  stream_options?: unknown;
  [k: string]:    unknown;
}

// ── Capability guard ──────────────────────────────────────────────────────────

interface GuardResult { canRoute: boolean; reason?: string }

/**
 * Check whether a request can safely be routed cross-provider.
 * Returns false with a reason when the request uses features that
 * the target model/provider does not support.
 */
export function canRouteCrossProvider(
  req:          OAIRequest,
  fromProvider: GatewayProvider,
  toProvider:   GatewayProvider,
): GuardResult {
  if (fromProvider === toProvider) return { canRoute: true };
  // azure_openai and openai share the same request/response format
  const openaiFamily = new Set(["openai", "azure_openai"]);
  if (openaiFamily.has(fromProvider) && openaiFamily.has(toProvider)) return { canRoute: true };

  // Structured output strict mode — Anthropic support is partial
  const rf = req.response_format as { type?: string; json_schema?: { strict?: boolean } } | undefined;
  if (toProvider === "anthropic" && rf?.type === "json_schema" && rf.json_schema?.strict) {
    return { canRoute: false, reason: "response_format.json_schema strict mode not supported by Anthropic" };
  }

  // parallel_tool_calls — not supported by Anthropic
  if (toProvider === "anthropic" && req.parallel_tool_calls === true) {
    return { canRoute: false, reason: "parallel_tool_calls not supported by Anthropic" };
  }

  // logprobs — not supported by Anthropic or Google
  if ((toProvider === "anthropic" || toProvider === "google") && req.logprobs) {
    return { canRoute: false, reason: `logprobs not supported by ${toProvider}` };
  }

  // Google does not support tool_choice: required
  if (toProvider === "google") {
    const tc = req.tool_choice as string | { type?: string } | undefined;
    if (tc === "required" || (typeof tc === "object" && tc?.type === "required")) {
      return { canRoute: false, reason: "tool_choice: required not supported by Google" };
    }
  }

  // Groq does not support parallel_tool_calls, logprobs, or strict JSON schema mode
  if (toProvider === "groq") {
    if (req.parallel_tool_calls === true) {
      return { canRoute: false, reason: "parallel_tool_calls not supported by Groq" };
    }
    if (req.logprobs) {
      return { canRoute: false, reason: "logprobs not supported by Groq" };
    }
    if (rf?.type === "json_schema" && rf.json_schema?.strict) {
      return { canRoute: false, reason: "response_format.json_schema strict mode not supported by Groq" };
    }
  }

  // xAI does not support logprobs
  if (toProvider === "xai" && req.logprobs) {
    return { canRoute: false, reason: "logprobs not supported by xAI" };
  }

  // Perplexity sonar search models do not support tool/function calling
  if (toProvider === "perplexity" && (req.tools as unknown[])?.length) {
    return { canRoute: false, reason: "tool/function calling not supported by Perplexity" };
  }

  // fireworks and together are broadly OpenAI-compatible — no known cross-routing blockers

  // Bedrock Converse API shares Anthropic's constraints (SigV4 auth, no logprobs, no parallel tools)
  if (toProvider === "bedrock") {
    if (req.parallel_tool_calls === true) {
      return { canRoute: false, reason: "parallel_tool_calls not supported by Bedrock" };
    }
    if (req.logprobs) {
      return { canRoute: false, reason: "logprobs not supported by Bedrock" };
    }
    if (rf?.type === "json_schema" && rf.json_schema?.strict) {
      return { canRoute: false, reason: "response_format.json_schema strict mode not supported by Bedrock" };
    }
  }

  return { canRoute: true };
}

// ── OpenAI → Anthropic ────────────────────────────────────────────────────────

function oaiToAnthropic(body: OAIRequest): Record<string, unknown> {
  const systemMsgs = body.messages.filter(m => m.role === "system");
  const otherMsgs  = body.messages.filter(m => m.role !== "system");

  const systemText = systemMsgs
    .map(m => (typeof m.content === "string" ? m.content : m.content.map(b => b.text ?? "").join("")))
    .join("\n");

  // Translate messages
  const messages = otherMsgs.map(m => {
    const role = m.role === "assistant" ? "assistant" : "user";

    // Tool result messages
    if (m.role === "tool") {
      return {
        role:    "user",
        content: [{ type: "tool_result", tool_use_id: m.tool_call_id, content: m.content }],
      };
    }

    // Assistant with tool calls
    if (m.tool_calls?.length) {
      return {
        role,
        content: [
          ...(m.content ? [{ type: "text", text: typeof m.content === "string" ? m.content : m.content.map(b => b.text ?? "").join("") }] : []),
          ...m.tool_calls.map(tc => ({
            type:  "tool_use",
            id:    tc.id,
            name:  tc.function.name,
            input: JSON.parse(tc.function.arguments || "{}"),
          })),
        ],
      };
    }

    // Regular messages
    if (typeof m.content === "string") {
      return { role, content: m.content };
    }

    // Content blocks (text + images)
    const content = (m.content as OAIContentBlock[]).map(b => {
      if (b.type === "image_url") {
        const url = b.image_url?.url ?? "";
        if (url.startsWith("data:")) {
          const [header, data] = url.split(",");
          const mediaType = header?.replace("data:", "").replace(";base64", "") ?? "image/jpeg";
          return { type: "image", source: { type: "base64", media_type: mediaType, data } };
        }
        return { type: "image", source: { type: "url", url } };
      }
      return { type: "text", text: b.text ?? "" };
    });
    return { role, content };
  });

  // Translate tools
  const tools = body.tools?.map(t => ({
    name:         t.function.name,
    description:  t.function.description,
    input_schema: t.function.parameters ?? { type: "object", properties: {} },
  }));

  // Translate tool_choice
  let tool_choice: unknown;
  if (body.tool_choice === "auto")     tool_choice = { type: "auto" };
  else if (body.tool_choice === "none") tool_choice = { type: "none" };
  else if (body.tool_choice === "required") tool_choice = { type: "any" };
  else if (typeof body.tool_choice === "object" && (body.tool_choice as { type?: string }).type === "function") {
    const name = (body.tool_choice as { function?: { name?: string } }).function?.name;
    tool_choice = { type: "tool", name };
  }

  const result: Record<string, unknown> = {
    model:      body.model,
    messages,
    max_tokens: body.max_tokens ?? 1024,
  };
  if (systemText)           result.system      = systemText;
  if (tools?.length)        result.tools       = tools;
  if (tool_choice)          result.tool_choice  = tool_choice;
  if (body.temperature)     result.temperature = body.temperature;
  if (body.stream)          result.stream      = body.stream;
  return result;
}

// ── Anthropic response → OpenAI ───────────────────────────────────────────────

function anthropicToOAI(body: unknown): Record<string, unknown> {
  const b = body as {
    id?: string; model?: string; stop_reason?: string; role?: string;
    content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };

  const textContent = (b.content ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join("");
  const toolUseBlocks = (b.content ?? []).filter(c => c.type === "tool_use");

  const message: Record<string, unknown> = {
    role:    "assistant",
    content: textContent || null,
  };

  if (toolUseBlocks.length) {
    message.tool_calls = toolUseBlocks.map((c, i) => ({
      id:       c.id ?? `call_${i}`,
      type:     "function",
      function: { name: c.name ?? "", arguments: JSON.stringify(c.input ?? {}) },
    }));
    if (!textContent) message.content = null;
  }

  const finishReasonMap: Record<string, string> = {
    end_turn: "stop", max_tokens: "length", tool_use: "tool_calls",
    stop_sequence: "stop",
  };

  const cached = b.usage?.cache_read_input_tokens ?? 0;
  return {
    id:      b.id ?? "",
    object:  "chat.completion",
    model:   b.model ?? "",
    choices: [{
      index:         0,
      message,
      finish_reason: finishReasonMap[b.stop_reason ?? "end_turn"] ?? "stop",
      logprobs:      null,
    }],
    usage: {
      prompt_tokens:     (b.usage?.input_tokens ?? 0),
      completion_tokens: (b.usage?.output_tokens ?? 0),
      total_tokens:      (b.usage?.input_tokens ?? 0) + (b.usage?.output_tokens ?? 0),
      prompt_tokens_details: { cached_tokens: cached, audio_tokens: 0 },
    },
  };
}

// ── OpenAI → Google Gemini ────────────────────────────────────────────────────

function oaiToGoogle(body: OAIRequest): Record<string, unknown> {
  const systemMsgs = body.messages.filter(m => m.role === "system");
  const otherMsgs  = body.messages.filter(m => m.role !== "system");

  const systemInstruction = systemMsgs.length ? {
    parts: [{ text: systemMsgs.map(m => typeof m.content === "string" ? m.content : "").join("\n") }],
  } : undefined;

  const contents = otherMsgs.map(m => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: typeof m.content === "string"
      ? [{ text: m.content }]
      : (m.content as OAIContentBlock[]).map(b =>
          b.type === "image_url"
            ? { inline_data: { mime_type: "image/jpeg", data: b.image_url?.url ?? "" } }
            : { text: b.text ?? "" }
        ),
  }));

  const tools = body.tools?.map(t => ({
    function_declarations: [{
      name:        t.function.name,
      description: t.function.description ?? "",
      parameters:  t.function.parameters,
    }],
  }));

  const result: Record<string, unknown> = { contents };
  if (systemInstruction)          result.system_instruction = systemInstruction;
  if (tools?.length)              result.tools              = tools;
  if (body.temperature !== undefined) result.generation_config = { temperature: body.temperature, ...(body.max_tokens ? { max_output_tokens: body.max_tokens } : {}) };
  return result;
}

// ── Google response → OpenAI ──────────────────────────────────────────────────

function googleToOAI(body: unknown, modelName: string): Record<string, unknown> {
  const b = body as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    modelVersion?: string;
  };

  const text = (b.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? "").join("");
  const finishMap: Record<string, string> = { STOP: "stop", MAX_TOKENS: "length", SAFETY: "content_filter" };

  return {
    id:      `gemini-${Date.now()}`,
    object:  "chat.completion",
    model:   b.modelVersion ?? modelName,
    choices: [{
      index:         0,
      message:       { role: "assistant", content: text },
      finish_reason: finishMap[b.candidates?.[0]?.finishReason ?? "STOP"] ?? "stop",
      logprobs:      null,
    }],
    usage: {
      prompt_tokens:     b.usageMetadata?.promptTokenCount     ?? 0,
      completion_tokens: b.usageMetadata?.candidatesTokenCount ?? 0,
      total_tokens:      (b.usageMetadata?.promptTokenCount ?? 0) + (b.usageMetadata?.candidatesTokenCount ?? 0),
    },
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Translate an OpenAI-format request body to the target provider's format.
 * Returns the original body unchanged for same-provider routing.
 */
export function normalizeRequest(
  body:         OAIRequest,
  fromProvider: GatewayProvider,
  toProvider:   GatewayProvider,
): Record<string, unknown> {
  if (fromProvider === toProvider) return body as unknown as Record<string, unknown>;
  // azure_openai uses the same wire format as openai
  if (toProvider === "azure_openai" || fromProvider === "azure_openai") return body as unknown as Record<string, unknown>;
  if (toProvider === "anthropic") return oaiToAnthropic(body);
  if (toProvider === "google")    return oaiToGoogle(body);
  // anthropic/google → openai: not needed for gateway (user sends OpenAI format)
  return body as unknown as Record<string, unknown>;
}

/**
 * Translate a provider's native response back to OpenAI format.
 * Returns the original response unchanged for OpenAI.
 */
export function normalizeResponse(
  responseBody: unknown,
  fromProvider: GatewayProvider,
  modelName:    string,
): Record<string, unknown> {
  if (fromProvider === "openai" || fromProvider === "azure_openai") return responseBody as Record<string, unknown>;
  if (fromProvider === "anthropic") return anthropicToOAI(responseBody);
  if (fromProvider === "google")    return googleToOAI(responseBody, modelName);
  return responseBody as Record<string, unknown>;
}

// ── Trace header utilities ────────────────────────────────────────────────────

export interface GatewayTraceContext {
  traceId:      string;
  spanId:       string;
  parentSpanId: string;
}

/**
 * Extract W3C traceparent or Prism-specific trace headers from an incoming request.
 * Returns null if no trace headers are present.
 *
 * Priority order:
 *   1. x-prism-trace-id   (explicit Prism trace ID, highest priority)
 *   2. traceparent         (W3C Trace Context, https://www.w3.org/TR/trace-context/)
 */
export function extractTraceHeaders(headers: Headers): GatewayTraceContext | null {
  // 1. Explicit Prism trace ID from SDK
  const prismTraceId    = headers.get("x-prism-trace-id");
  const prismParentSpan = headers.get("x-prism-parent-span");
  if (prismTraceId) {
    return {
      traceId:      prismTraceId,
      spanId:       crypto.randomUUID().replace(/-/g, ""),
      parentSpanId: prismParentSpan ?? "",
    };
  }

  // 2. W3C traceparent: "00-{traceId}-{parentSpanId}-{flags}"
  const traceparent = headers.get("traceparent");
  if (traceparent) {
    const parts = traceparent.split("-");
    if (parts.length >= 3 && parts[0] === "00") {
      return {
        traceId:      parts[1] ?? "",
        spanId:       crypto.randomUUID().replace(/-/g, ""),
        parentSpanId: parts[2] ?? "",
      };
    }
  }

  return null;
}

/**
 * Inject trace context into outgoing upstream request headers.
 * Sets both W3C traceparent and Prism-specific headers so that
 * downstream LLM providers that support distributed tracing can correlate.
 */
export function injectTraceHeaders(
  outgoing: Record<string, string>,
  ctx: GatewayTraceContext,
): void {
  outgoing["traceparent"]       = `00-${ctx.traceId}-${ctx.spanId}-01`;
  outgoing["x-prism-trace-id"]  = ctx.traceId;
}
