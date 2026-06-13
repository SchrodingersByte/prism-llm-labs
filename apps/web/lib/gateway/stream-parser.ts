/**
 * Streaming usage extraction for the gateway.
 *
 * `extractUsage` is a pure function: feed it each parsed SSE JSON chunk and it
 * accumulates token usage into the passed `UsageSummary`. It is provider-aware
 * because the three wire formats report usage differently:
 *
 *   - OpenAI-wire (openai, azure_openai, groq, mistral, xai, cerebras, nebius,
 *     together, fireworks, perplexity, openrouter, cohere, ollama,
 *     openai_compatible, and bedrock — which lib/gateway/bedrock.ts pre-translates
 *     to OpenAI chunk shape): `usage.prompt_tokens` / `usage.completion_tokens`,
 *     with cached/reasoning/audio subsets in `prompt_tokens_details` /
 *     `completion_tokens_details`. The final chunk carries usage when
 *     `stream_options.include_usage=true`.
 *   - Anthropic: `message_start` carries `message.usage.input_tokens` (+ cache
 *     read/creation), `message_delta` carries `usage.output_tokens`.
 *   - Google Gemini: each chunk may carry `usageMetadata` (the last chunk holds
 *     the cumulative counts), incl. per-modality detail arrays + `thoughtsTokenCount`.
 *
 * Token convention (must match `calculateCost` in lib/pricing/table.ts):
 *   inputTokens  = TOTAL prompt tokens, INCLUDING the cached subset.
 *   cachedTokens = the cache-read subset, billed at the discounted `cached_input`
 *                  rate (calculateCost does `uncachedInput = inputTokens - cachedTokens`).
 * OpenAI and Google already count cached tokens inside the prompt total. Anthropic
 * reports `input_tokens` EXCLUDING cache, so we add the cache read/creation tokens
 * back into `inputTokens` to keep the convention consistent across providers.
 *
 * reasoning/image/audio are observability sub-counts (modality analytics), NOT
 * separate cost terms — reasoning tokens are already inside output_tokens, and
 * image/audio prompt tokens are already inside input_tokens. They populate the
 * llm_events modality columns; they must not be double-counted in cost.
 */

export interface UsageSummary {
  model:           string;
  inputTokens:     number;
  outputTokens:    number;
  cachedTokens:    number;
  reasoningTokens: number;
  imageTokens:     number;
  audioTokens:     number;
  requestId:       string;
}

/** A zeroed summary; `model` defaults to the resolved model so cost is attributed even if no chunk overrides it. */
export function newUsageSummary(model = ""): UsageSummary {
  return {
    model, inputTokens: 0, outputTokens: 0, cachedTokens: 0,
    reasoningTokens: 0, imageTokens: 0, audioTokens: 0, requestId: "",
  };
}

/**
 * Accumulate token usage from a single parsed streaming chunk into `summary`.
 * Safe to call on every chunk — fields are only overwritten when present, so the
 * final usage chunk wins. Never throws.
 */
export function extractUsage(
  provider: string,
  json:     Record<string, unknown>,
  summary:  UsageSummary,
): void {
  if (provider === "anthropic") { extractAnthropic(json, summary); return; }
  if (provider === "google")    { extractGoogle(json, summary);    return; }
  // Default: OpenAI wire format. Covers every OpenAI-compatible provider plus
  // bedrock (pre-translated) and any unknown provider that proxies the schema.
  extractOpenAI(json, summary);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

// ── OpenAI wire (and all OpenAI-compatible providers) ──────────────────────────

function extractOpenAI(json: Record<string, unknown>, summary: UsageSummary): void {
  if (typeof json.model === "string") summary.model     = json.model;
  if (typeof json.id    === "string") summary.requestId = json.id;

  const usage = json.usage as Record<string, unknown> | null | undefined;
  if (!usage) return; // intermediate chunks send `usage: null`

  summary.inputTokens  = num(usage.prompt_tokens)     ?? summary.inputTokens;
  summary.outputTokens = num(usage.completion_tokens) ?? summary.outputTokens;

  const promptDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const compDetails   = usage.completion_tokens_details as Record<string, unknown> | undefined;

  const cached = num(promptDetails?.cached_tokens);
  if (cached !== undefined) summary.cachedTokens = cached;

  // reasoning tokens (o1/o3/gpt-5 thinking) are a subset of completion_tokens.
  const reasoning = num(compDetails?.reasoning_tokens);
  if (reasoning !== undefined) summary.reasoningTokens = reasoning;

  // audio tokens may appear on either side for audio-capable models.
  const audio = (num(promptDetails?.audio_tokens) ?? 0) + (num(compDetails?.audio_tokens) ?? 0);
  if (audio > 0) summary.audioTokens = audio;
  // OpenAI does not expose an image-token sub-count; image inputs are folded
  // into prompt_tokens. Leave imageTokens at 0 for the OpenAI family.
}

// ── Anthropic Messages streaming ───────────────────────────────────────────────

function extractAnthropic(json: Record<string, unknown>, summary: UsageSummary): void {
  const type = json.type as string | undefined;

  if (type === "message_start") {
    const msg = json.message as Record<string, unknown> | undefined;
    if (!msg) return;
    if (typeof msg.model === "string") summary.model     = msg.model;
    if (typeof msg.id    === "string") summary.requestId = msg.id;

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (usage) {
      const input       = num(usage.input_tokens)                 ?? 0;
      const cacheRead   = num(usage.cache_read_input_tokens)      ?? 0;
      const cacheCreate = num(usage.cache_creation_input_tokens)  ?? 0;
      // input_tokens excludes cache → add the cached portions back so inputTokens
      // is the full prompt, matching the calculateCost convention.
      summary.inputTokens  = input + cacheRead + cacheCreate;
      summary.cachedTokens = cacheRead;
      const out = num(usage.output_tokens);
      if (out !== undefined) summary.outputTokens = out;
    }
    return;
  }

  if (type === "message_delta") {
    const usage = json.usage as Record<string, unknown> | undefined;
    const out   = num(usage?.output_tokens);
    if (out !== undefined) summary.outputTokens = out;
  }
  // Anthropic does not break usage down by modality, and extended-thinking tokens
  // are already inside output_tokens, so reasoning/image/audio stay 0 here.
}

// ── Google Gemini streaming ────────────────────────────────────────────────────

function sumModality(details: unknown, modality: string): number {
  if (!Array.isArray(details)) return 0;
  let total = 0;
  for (const d of details) {
    const row = d as { modality?: string; tokenCount?: number };
    if (row?.modality === modality) total += num(row.tokenCount) ?? 0;
  }
  return total;
}

function extractGoogle(json: Record<string, unknown>, summary: UsageSummary): void {
  if (typeof json.modelVersion === "string") summary.model = json.modelVersion;

  const meta = json.usageMetadata as Record<string, unknown> | undefined;
  if (!meta) return;

  // promptTokenCount already includes the cached subset (cachedContentTokenCount).
  summary.inputTokens  = num(meta.promptTokenCount)     ?? summary.inputTokens;
  summary.outputTokens = num(meta.candidatesTokenCount) ?? summary.outputTokens;
  const cached = num(meta.cachedContentTokenCount);
  if (cached !== undefined) summary.cachedTokens = cached;

  // Gemini 2.5 "thinking" tokens (a subset of output).
  const thoughts = num(meta.thoughtsTokenCount);
  if (thoughts !== undefined) summary.reasoningTokens = thoughts;

  // Per-modality detail arrays appear on the prompt and candidates sides.
  const image = sumModality(meta.promptTokensDetails, "IMAGE") + sumModality(meta.candidatesTokensDetails, "IMAGE");
  const audio = sumModality(meta.promptTokensDetails, "AUDIO") + sumModality(meta.candidatesTokensDetails, "AUDIO");
  if (image > 0) summary.imageTokens = image;
  if (audio > 0) summary.audioTokens = audio;
}
