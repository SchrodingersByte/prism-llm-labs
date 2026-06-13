/**
 * Pricing per 1,000,000 tokens (USD).
 *
 * Last verified: July 2026 via OpenRouter live API + provider pricing pages:
 *   OpenAI:    https://openai.com/pricing
 *   Anthropic: https://anthropic.com/pricing
 *   Google:    https://ai.google.dev/pricing
 *   OpenRouter live: https://openrouter.ai/api/v1/models
 *
 * Prefix-matching means versioned IDs are handled automatically:
 *   "gpt-4o-2024-11-20" → "gpt-4o" pricing.
 * Unknown models return 0 cost.
 *
 * SYNC NOTE: This file must stay in sync with packages/python-sdk/prism/_pricing.py.
 * Run `pnpm test:pricing-parity` in CI to validate after any change.
 */
export const MODEL_PRICING: Record<string, {
  input: number;
  output: number;
  cached_input?: number;
  provider: "openai" | "anthropic" | "google" | "openrouter";
}> = {
  // ── OpenAI GPT-4o family ───────────────────────────────────────────────────
  "gpt-4o":                     { provider: "openai",    input: 2.50,   output: 10.00,  cached_input: 1.25 },
  "gpt-4o-mini":                { provider: "openai",    input: 0.15,   output: 0.60,   cached_input: 0.075 },
  "gpt-4o-audio-preview":       { provider: "openai",    input: 2.50,   output: 10.00 },

  // ── OpenAI GPT-4.1 family (April 2025) ────────────────────────────────────
  "gpt-4.1":                    { provider: "openai",    input: 2.00,   output: 8.00,   cached_input: 0.50 },
  "gpt-4.1-mini":               { provider: "openai",    input: 0.40,   output: 1.60,   cached_input: 0.10 },
  "gpt-4.1-nano":               { provider: "openai",    input: 0.10,   output: 0.40,   cached_input: 0.025 },

  // ── OpenAI GPT-5 family ────────────────────────────────────────────────────
  "gpt-5":                      { provider: "openai",    input: 1.25,   output: 10.00,  cached_input: 0.31 },
  "gpt-5-mini":                 { provider: "openai",    input: 0.25,   output: 2.00,   cached_input: 0.063 },
  "gpt-5-nano":                 { provider: "openai",    input: 0.05,   output: 0.40,   cached_input: 0.013 },
  "gpt-5-pro":                  { provider: "openai",    input: 15.00,  output: 120.00 },

  // ── OpenAI GPT-4.5 (February 2025) ────────────────────────────────────────
  "gpt-4.5-preview":            { provider: "openai",    input: 75.00,  output: 150.00 },

  // ── OpenAI o-series reasoning models ──────────────────────────────────────
  // o3 pricing reduced by OpenAI in April 2025 from $10/$40 to $2/$8.
  "o1":                         { provider: "openai",    input: 15.00,  output: 60.00,  cached_input: 7.50 },
  "o1-mini":                    { provider: "openai",    input: 3.00,   output: 12.00,  cached_input: 1.50 },
  "o1-pro":                     { provider: "openai",    input: 150.00, output: 600.00 },
  "o3":                         { provider: "openai",    input: 2.00,   output: 8.00,   cached_input: 0.50 },
  "o3-mini":                    { provider: "openai",    input: 1.10,   output: 4.40,   cached_input: 0.55 },
  "o3-pro":                     { provider: "openai",    input: 20.00,  output: 80.00 },
  "o4-mini":                    { provider: "openai",    input: 1.10,   output: 4.40,   cached_input: 0.275 },

  // ── OpenAI legacy GPT-4 ───────────────────────────────────────────────────
  "gpt-4-turbo":                { provider: "openai",    input: 10.00,  output: 30.00 },
  "gpt-4-turbo-preview":        { provider: "openai",    input: 10.00,  output: 30.00 },
  "gpt-4":                      { provider: "openai",    input: 30.00,  output: 60.00 },
  "gpt-3.5-turbo":              { provider: "openai",    input: 0.50,   output: 1.50 },

  // ── OpenAI embeddings ─────────────────────────────────────────────────────
  "text-embedding-3-small":     { provider: "openai",    input: 0.02,   output: 0 },
  "text-embedding-3-large":     { provider: "openai",    input: 0.13,   output: 0 },
  "text-embedding-ada-002":     { provider: "openai",    input: 0.10,   output: 0 },

  // ── Anthropic Claude 4 family ─────────────────────────────────────────────
  "claude-opus-4-5":            { provider: "anthropic", input: 15.00,  output: 75.00,  cached_input: 1.50 },
  "claude-opus-4":              { provider: "anthropic", input: 15.00,  output: 75.00,  cached_input: 1.50 },
  "claude-sonnet-4-5":          { provider: "anthropic", input: 3.00,   output: 15.00,  cached_input: 0.30 },
  "claude-sonnet-4":            { provider: "anthropic", input: 3.00,   output: 15.00,  cached_input: 0.30 },
  "claude-haiku-4-5":           { provider: "anthropic", input: 1.00,   output: 5.00,   cached_input: 0.10 },
  "claude-haiku-4":             { provider: "anthropic", input: 0.80,   output: 4.00,   cached_input: 0.08 },

  // ── Anthropic Claude 3.7 ──────────────────────────────────────────────────
  "claude-3-7-sonnet-20250219": { provider: "anthropic", input: 3.00,   output: 15.00,  cached_input: 0.30 },

  // ── Anthropic Claude 3.5 ──────────────────────────────────────────────────
  "claude-3-5-sonnet-20241022": { provider: "anthropic", input: 3.00,   output: 15.00,  cached_input: 0.30 },
  "claude-3-5-haiku-20241022":  { provider: "anthropic", input: 0.80,   output: 4.00,   cached_input: 0.08 },

  // ── Anthropic Claude 3 ────────────────────────────────────────────────────
  "claude-3-opus-20240229":     { provider: "anthropic", input: 15.00,  output: 75.00 },
  "claude-3-sonnet-20240229":   { provider: "anthropic", input: 3.00,   output: 15.00 },
  "claude-3-haiku-20240307":    { provider: "anthropic", input: 0.25,   output: 1.25 },

  // ── Google Gemini 3.x (2026) ──────────────────────────────────────────────
  "gemini-3.5-flash":           { provider: "google",    input: 1.50,   output: 9.00 },
  "gemini-3.1-pro":             { provider: "google",    input: 2.00,   output: 12.00 },
  "gemini-3.1-flash":           { provider: "google",    input: 0.50,   output: 3.00 },
  "gemini-3.1-flash-lite":      { provider: "google",    input: 0.25,   output: 1.50 },
  "gemini-3-pro":               { provider: "google",    input: 2.00,   output: 12.00 },
  "gemini-3-flash":             { provider: "google",    input: 0.50,   output: 3.00 },

  // ── Google Gemini 2.5 ─────────────────────────────────────────────────────
  "gemini-2.5-pro":             { provider: "google",    input: 1.25,   output: 10.00 },
  "gemini-2.5-flash":           { provider: "google",    input: 0.30,   output: 2.50 },
  "gemini-2.5-flash-lite":      { provider: "google",    input: 0.10,   output: 0.40 },

  // ── Google Gemini 2.0 ─────────────────────────────────────────────────────
  "gemini-2.0-flash":           { provider: "google",    input: 0.10,   output: 0.40 },
  "gemini-2.0-flash-lite":      { provider: "google",    input: 0.075,  output: 0.30 },

  // ── Google Gemini 1.5 ─────────────────────────────────────────────────────
  "gemini-1.5-pro":             { provider: "google",    input: 1.25,   output: 5.00 },
  "gemini-1.5-flash":           { provider: "google",    input: 0.075,  output: 0.30 },
  "gemini-1.5-flash-8b":        { provider: "google",    input: 0.0375, output: 0.15 },

  // ── OpenRouter — Meta LLaMA 4 ─────────────────────────────────────────────
  "meta-llama/llama-4-maverick":           { provider: "openrouter", input: 0.15,  output: 0.60 },
  "meta-llama/llama-4-scout":              { provider: "openrouter", input: 0.08,  output: 0.30 },

  // ── OpenRouter — Meta LLaMA 3 ─────────────────────────────────────────────
  "meta-llama/llama-3.3-70b-instruct":     { provider: "openrouter", input: 0.10,  output: 0.32 },
  "meta-llama/llama-3.1-70b-instruct":     { provider: "openrouter", input: 0.40,  output: 0.40 },
  "meta-llama/llama-3.1-8b-instruct":      { provider: "openrouter", input: 0.02,  output: 0.03 },
  "meta-llama/llama-3.2-3b-instruct":      { provider: "openrouter", input: 0.051, output: 0.335 },
  "meta-llama/llama-3.2-1b-instruct":      { provider: "openrouter", input: 0.027, output: 0.201 },

  // ── OpenRouter — Mistral ───────────────────────────────────────────────────
  "mistralai/mistral-large-2512":          { provider: "openrouter", input: 0.50,  output: 1.50 },
  "mistralai/mistral-large":               { provider: "openrouter", input: 2.00,  output: 6.00 },
  "mistralai/mistral-medium-3":            { provider: "openrouter", input: 0.40,  output: 2.00 },
  "mistralai/mistral-small-3":             { provider: "openrouter", input: 0.075, output: 0.20 },
  "mistralai/mistral-nemo":                { provider: "openrouter", input: 0.02,  output: 0.03 },
  "mistralai/mixtral-8x22b-instruct":      { provider: "openrouter", input: 2.00,  output: 6.00 },
  "mistralai/mixtral-8x7b-instruct":       { provider: "openrouter", input: 0.24,  output: 0.24 },
  "mistralai/codestral-2508":              { provider: "openrouter", input: 0.30,  output: 0.90 },

  // ── OpenRouter — Google Gemma ──────────────────────────────────────────────
  "google/gemma-4-31b-it":                 { provider: "openrouter", input: 0.12,  output: 0.37 },
  "google/gemma-4-26b-a4b-it":             { provider: "openrouter", input: 0.06,  output: 0.33 },
  "google/gemma-3-27b-it":                 { provider: "openrouter", input: 0.08,  output: 0.16 },
  "google/gemma-3-12b-it":                 { provider: "openrouter", input: 0.04,  output: 0.13 },
  "google/gemma-2-27b-it":                 { provider: "openrouter", input: 0.65,  output: 0.65 },

  // ── OpenRouter — DeepSeek ──────────────────────────────────────────────────
  "deepseek/deepseek-r1-0528":             { provider: "openrouter", input: 0.50,  output: 2.15 },
  "deepseek/deepseek-r1":                  { provider: "openrouter", input: 0.70,  output: 2.50 },
  "deepseek/deepseek-v3.2":               { provider: "openrouter", input: 0.229, output: 0.343 },
  "deepseek/deepseek-v4-pro":             { provider: "openrouter", input: 0.435, output: 0.87 },
  "deepseek/deepseek-v4-flash":           { provider: "openrouter", input: 0.098, output: 0.197 },
  "deepseek/deepseek-chat-v3-0324":       { provider: "openrouter", input: 0.20,  output: 0.77 },
  "deepseek/deepseek-r1-distill-llama-70b": { provider: "openrouter", input: 0.70, output: 0.80 },
  "deepseek/deepseek-r1-distill-qwen-32b": { provider: "openrouter", input: 0.29,  output: 0.29 },

  // ── OpenRouter — Qwen3 ────────────────────────────────────────────────────
  "qwen/qwen3-235b-a22b":                  { provider: "openrouter", input: 0.455, output: 1.82 },
  "qwen/qwen3-32b":                        { provider: "openrouter", input: 0.08,  output: 0.28 },
  "qwen/qwen3-30b-a3b":                    { provider: "openrouter", input: 0.09,  output: 0.45 },
  "qwen/qwen3-14b":                        { provider: "openrouter", input: 0.10,  output: 0.24 },
  "qwen/qwen3-8b":                         { provider: "openrouter", input: 0.05,  output: 0.40 },
  "qwen/qwen3-coder":                      { provider: "openrouter", input: 0.22,  output: 1.80 },
  "qwen/qwen3-max":                        { provider: "openrouter", input: 0.78,  output: 3.90 },

  // ── OpenRouter — Qwen2.5 ──────────────────────────────────────────────────
  "qwen/qwen-2.5-72b-instruct":            { provider: "openrouter", input: 0.36,  output: 0.40 },
  "qwen/qwen-2.5-7b-instruct":             { provider: "openrouter", input: 0.04,  output: 0.10 },
  "qwen/qwen-2.5-coder-32b-instruct":      { provider: "openrouter", input: 0.66,  output: 1.00 },
  "qwen/qwen-plus":                        { provider: "openrouter", input: 0.26,  output: 0.78 },

  // ── OpenRouter — Microsoft Phi ─────────────────────────────────────────────
  "microsoft/phi-4":                       { provider: "openrouter", input: 0.065, output: 0.14 },
  "microsoft/phi-4-mini-instruct":         { provider: "openrouter", input: 0.08,  output: 0.35 },
  "microsoft/phi-3.5-mini-128k-instruct":  { provider: "openrouter", input: 0.10,  output: 0.10 },
  "microsoft/phi-3-medium-128k-instruct":  { provider: "openrouter", input: 0.14,  output: 0.14 },

  // ── OpenRouter — xAI Grok ─────────────────────────────────────────────────
  "x-ai/grok-4.20":                        { provider: "openrouter", input: 1.25,  output: 2.50 },
  "x-ai/grok-4.3":                         { provider: "openrouter", input: 1.25,  output: 2.50 },
  "x-ai/grok-4.20-multi-agent":            { provider: "openrouter", input: 2.00,  output: 6.00 },

  // ── OpenRouter — Amazon Nova ──────────────────────────────────────────────
  "amazon/nova-premier-v1":                { provider: "openrouter", input: 2.50,  output: 12.50 },
  "amazon/nova-pro-v1":                    { provider: "openrouter", input: 0.80,  output: 3.20 },
  "amazon/nova-lite-v1":                   { provider: "openrouter", input: 0.06,  output: 0.24 },
  "amazon/nova-micro-v1":                  { provider: "openrouter", input: 0.035, output: 0.14 },

  // ── OpenRouter — Perplexity ────────────────────────────────────────────────
  "perplexity/sonar-pro":                  { provider: "openrouter", input: 3.00,  output: 15.00 },
  "perplexity/sonar":                      { provider: "openrouter", input: 1.00,  output: 1.00 },

  // ── OpenRouter — Cohere ───────────────────────────────────────────────────
  "cohere/command-a":                      { provider: "openrouter", input: 2.50,  output: 10.00 },
  "cohere/command-r-plus-08-2024":         { provider: "openrouter", input: 2.50,  output: 10.00 },
  "cohere/command-r-08-2024":              { provider: "openrouter", input: 0.15,  output: 0.60 },

  // ── OpenRouter — NVIDIA Nemotron ──────────────────────────────────────────
  "nvidia/nemotron-3-ultra-550b-a55b":     { provider: "openrouter", input: 0.50,  output: 2.50 },
  "nvidia/nemotron-3-super-120b-a12b":     { provider: "openrouter", input: 0.09,  output: 0.45 },

  // ── OpenRouter — Free models ($0, :free suffix) ───────────────────────────
  "meta-llama/llama-3.3-70b-instruct:free":       { provider: "openrouter", input: 0, output: 0 },
  "meta-llama/llama-3.2-3b-instruct:free":        { provider: "openrouter", input: 0, output: 0 },
  "google/gemma-4-31b-it:free":                   { provider: "openrouter", input: 0, output: 0 },
  "google/gemma-4-26b-a4b-it:free":               { provider: "openrouter", input: 0, output: 0 },
  "deepseek/deepseek-r1:free":                    { provider: "openrouter", input: 0, output: 0 },
  "deepseek/deepseek-chat-v3-0324:free":          { provider: "openrouter", input: 0, output: 0 },
  "qwen/qwen3-235b-a22b:free":                    { provider: "openrouter", input: 0, output: 0 },
  "qwen/qwen3-30b-a3b:free":                      { provider: "openrouter", input: 0, output: 0 },
  "qwen/qwen3-coder:free":                        { provider: "openrouter", input: 0, output: 0 },
  "qwen/qwen3-next-80b-a3b-instruct:free":        { provider: "openrouter", input: 0, output: 0 },
  "moonshotai/kimi-k2.6:free":                    { provider: "openrouter", input: 0, output: 0 },
  "nvidia/nemotron-3-ultra-550b-a55b:free":       { provider: "openrouter", input: 0, output: 0 },
  "nvidia/nemotron-3-super-120b-a12b:free":       { provider: "openrouter", input: 0, output: 0 },
  "nvidia/nemotron-3-nano-30b-a3b:free":          { provider: "openrouter", input: 0, output: 0 },
  "nvidia/nemotron-nano-9b-v2:free":              { provider: "openrouter", input: 0, output: 0 },
  "openai/gpt-oss-120b:free":                     { provider: "openrouter", input: 0, output: 0 },
  "openai/gpt-oss-20b:free":                      { provider: "openrouter", input: 0, output: 0 },
  "poolside/laguna-m.1:free":                     { provider: "openrouter", input: 0, output: 0 },
  "poolside/laguna-xs.2:free":                    { provider: "openrouter", input: 0, output: 0 },
  "z-ai/glm-4.5-air:free":                        { provider: "openrouter", input: 0, output: 0 },
  "nousresearch/hermes-3-llama-3.1-405b:free":    { provider: "openrouter", input: 0, output: 0 },
  "liquid/lfm-2.5-1.2b-instruct:free":            { provider: "openrouter", input: 0, output: 0 },
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free": { provider: "openrouter", input: 0, output: 0 },

  // ── OpenRouter — paid OSS models ──────────────────────────────────────────
  "openai/gpt-oss-120b":                          { provider: "openrouter", input: 0.039, output: 0.18 },
  "openai/gpt-oss-20b":                           { provider: "openrouter", input: 0.029, output: 0.14 },
};

const _SORTED_KEYS = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);

/**
 * Normalize a versioned model name to its canonical pricing-table key.
 * "gpt-4o-mini-2024-07-18" → "gpt-4o-mini"
 * "gpt-4o-mini"            → "gpt-4o-mini"
 * "unknown-model"          → "unknown-model"
 */
export function normalizeModelName(model: string): string {
  if (MODEL_PRICING[model]) return model;
  for (const key of _SORTED_KEYS) {
    if (model.startsWith(key)) return key;
  }
  return model;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const canonical = normalizeModelName(model);
  const p = MODEL_PRICING[canonical];
  if (!p) return 0;
  const uncachedInput = inputTokens - cachedTokens;
  return (
    (uncachedInput * p.input) / 1_000_000 +
    (cachedTokens * (p.cached_input ?? p.input)) / 1_000_000 +
    (outputTokens * p.output) / 1_000_000
  );
}
