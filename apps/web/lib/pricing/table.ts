/**
 * Pricing per 1,000,000 tokens (USD).
 *
 * Last verified: July 2026 via OpenRouter API + provider pricing pages.
 *   OpenAI:    https://openai.com/pricing
 *   Anthropic: https://anthropic.com/pricing
 *   Google:    https://ai.google.dev/pricing
 *   OpenRouter live: https://openrouter.ai/api/v1/models
 *
 * Prefix-matching via resolveModel() handles versioned IDs automatically:
 *   "gpt-4o-2024-11-20" → "gpt-4o" pricing.
 * Unknown models return null → cost recorded as $0.
 *
 * OpenRouter-namespaced models (vendor/model) use the live OR API price.
 * Direct provider models use the provider's published price.
 */
export const MODEL_PRICING: Record<string, {
  input: number;
  output: number;
  cached_input?: number;
  provider: "openai" | "anthropic" | "google" | "openrouter" | "groq" | "xai" | "fireworks" | "together" | "perplexity" | "mistral" | "cerebras" | "nebius" | "cohere" | "bedrock";
}> = {

  // ── OpenAI GPT-4o family ───────────────────────────────────────────────────
  "gpt-4o":                     { provider: "openai", input: 2.50,   output: 10.00, cached_input: 1.25  },
  "gpt-4o-mini":                { provider: "openai", input: 0.15,   output: 0.60,  cached_input: 0.075 },
  "gpt-4o-audio-preview":       { provider: "openai", input: 2.50,   output: 10.00 },

  // ── OpenAI GPT-4.1 family (April 2025) ────────────────────────────────────
  "gpt-4.1":                    { provider: "openai", input: 2.00,   output: 8.00,  cached_input: 0.50  },
  "gpt-4.1-mini":               { provider: "openai", input: 0.40,   output: 1.60,  cached_input: 0.10  },
  "gpt-4.1-nano":               { provider: "openai", input: 0.10,   output: 0.40,  cached_input: 0.025 },

  // ── OpenAI GPT-5 family ────────────────────────────────────────────────────
  "gpt-5":                      { provider: "openai", input: 1.25,   output: 10.00, cached_input: 0.31  },
  "gpt-5-mini":                 { provider: "openai", input: 0.25,   output: 2.00,  cached_input: 0.063 },
  "gpt-5-nano":                 { provider: "openai", input: 0.05,   output: 0.40,  cached_input: 0.013 },
  "gpt-5-pro":                  { provider: "openai", input: 15.00,  output: 120.00 },

  // ── OpenAI GPT-4.5 ────────────────────────────────────────────────────────
  "gpt-4.5-preview":            { provider: "openai", input: 75.00,  output: 150.00 },

  // ── OpenAI o-series reasoning models ──────────────────────────────────────
  // Reasoning (thinking) tokens billed at output price.
  // o3 pricing reduced by OpenAI in April 2025 from $10/$40 to $2/$8.
  "o1":                         { provider: "openai", input: 15.00,  output: 60.00, cached_input: 7.50  },
  "o1-mini":                    { provider: "openai", input: 3.00,   output: 12.00, cached_input: 1.50  },
  "o1-pro":                     { provider: "openai", input: 150.00, output: 600.00 },
  "o3":                         { provider: "openai", input: 2.00,   output: 8.00,  cached_input: 0.50  },
  "o3-mini":                    { provider: "openai", input: 1.10,   output: 4.40,  cached_input: 0.55  },
  "o3-pro":                     { provider: "openai", input: 20.00,  output: 80.00 },
  "o4-mini":                    { provider: "openai", input: 1.10,   output: 4.40,  cached_input: 0.275 },

  // ── OpenAI legacy GPT-4 ───────────────────────────────────────────────────
  "gpt-4-turbo":                { provider: "openai", input: 10.00,  output: 30.00 },
  "gpt-4-turbo-preview":        { provider: "openai", input: 10.00,  output: 30.00 },
  "gpt-4":                      { provider: "openai", input: 30.00,  output: 60.00 },
  "gpt-3.5-turbo":              { provider: "openai", input: 0.50,   output: 1.50  },

  // ── OpenAI embeddings ─────────────────────────────────────────────────────
  "text-embedding-3-small":     { provider: "openai", input: 0.02,   output: 0 },
  "text-embedding-3-large":     { provider: "openai", input: 0.13,   output: 0 },
  "text-embedding-ada-002":     { provider: "openai", input: 0.10,   output: 0 },

  // ── Anthropic Claude 4 family ─────────────────────────────────────────────
  "claude-opus-4-5":            { provider: "anthropic", input: 15.00, output: 75.00, cached_input: 1.50 },
  "claude-opus-4":              { provider: "anthropic", input: 15.00, output: 75.00, cached_input: 1.50 },
  "claude-sonnet-4-5":          { provider: "anthropic", input: 3.00,  output: 15.00, cached_input: 0.30 },
  "claude-sonnet-4":            { provider: "anthropic", input: 3.00,  output: 15.00, cached_input: 0.30 },
  "claude-haiku-4-5":           { provider: "anthropic", input: 1.00,  output: 5.00,  cached_input: 0.10 },
  "claude-haiku-4":             { provider: "anthropic", input: 0.80,  output: 4.00,  cached_input: 0.08 },

  // ── Anthropic Claude 3.7 ──────────────────────────────────────────────────
  "claude-3-7-sonnet-20250219": { provider: "anthropic", input: 3.00,  output: 15.00, cached_input: 0.30 },

  // ── Anthropic Claude 3.5 ──────────────────────────────────────────────────
  "claude-3-5-sonnet-20241022": { provider: "anthropic", input: 3.00,  output: 15.00, cached_input: 0.30 },
  "claude-3-5-haiku-20241022":  { provider: "anthropic", input: 0.80,  output: 4.00,  cached_input: 0.08 },

  // ── Anthropic Claude 3 ────────────────────────────────────────────────────
  "claude-3-opus-20240229":     { provider: "anthropic", input: 15.00, output: 75.00 },
  "claude-3-sonnet-20240229":   { provider: "anthropic", input: 3.00,  output: 15.00 },
  "claude-3-haiku-20240307":    { provider: "anthropic", input: 0.25,  output: 1.25  },

  // ── Google Gemini 3.x (2026) ──────────────────────────────────────────────
  "gemini-3.5-flash":           { provider: "google", input: 1.50,   output: 9.00  },
  "gemini-3.1-pro":             { provider: "google", input: 2.00,   output: 12.00 },
  "gemini-3.1-flash":           { provider: "google", input: 0.50,   output: 3.00  },
  "gemini-3.1-flash-lite":      { provider: "google", input: 0.25,   output: 1.50  },
  "gemini-3-pro":               { provider: "google", input: 2.00,   output: 12.00 },
  "gemini-3-flash":             { provider: "google", input: 0.50,   output: 3.00  },

  // ── Google Gemini 2.5 ─────────────────────────────────────────────────────
  "gemini-2.5-pro":             { provider: "google", input: 1.25,   output: 10.00 },
  "gemini-2.5-flash":           { provider: "google", input: 0.30,   output: 2.50  },
  "gemini-2.5-flash-lite":      { provider: "google", input: 0.10,   output: 0.40  },

  // ── Google Gemini 2.0 ─────────────────────────────────────────────────────
  "gemini-2.0-flash":           { provider: "google", input: 0.10,   output: 0.40  },
  "gemini-2.0-flash-lite":      { provider: "google", input: 0.075,  output: 0.30  },

  // ── Google Gemini 1.5 ─────────────────────────────────────────────────────
  "gemini-1.5-pro":             { provider: "google", input: 1.25,   output: 5.00  },
  "gemini-1.5-flash":           { provider: "google", input: 0.075,  output: 0.30  },
  "gemini-1.5-flash-8b":        { provider: "google", input: 0.0375, output: 0.15  },

  // ── OpenRouter — Meta LLaMA 4 (2025–2026) ─────────────────────────────────
  "meta-llama/llama-4-maverick":           { provider: "openrouter", input: 0.15,  output: 0.60  },
  "meta-llama/llama-4-scout":              { provider: "openrouter", input: 0.08,  output: 0.30  },

  // ── OpenRouter — Meta LLaMA 3 ─────────────────────────────────────────────
  "meta-llama/llama-3.3-70b-instruct":     { provider: "openrouter", input: 0.10,  output: 0.32  },
  "meta-llama/llama-3.1-70b-instruct":     { provider: "openrouter", input: 0.40,  output: 0.40  },
  "meta-llama/llama-3.1-8b-instruct":      { provider: "openrouter", input: 0.02,  output: 0.03  },
  "meta-llama/llama-3.2-3b-instruct":      { provider: "openrouter", input: 0.051, output: 0.335 },
  "meta-llama/llama-3.2-1b-instruct":      { provider: "openrouter", input: 0.027, output: 0.201 },

  // ── OpenRouter — Mistral (updated prices) ────────────────────────────────
  "mistralai/mistral-large-2512":          { provider: "openrouter", input: 0.50,  output: 1.50  },
  "mistralai/mistral-large":               { provider: "openrouter", input: 2.00,  output: 6.00  },
  "mistralai/mistral-medium-3":            { provider: "openrouter", input: 0.40,  output: 2.00  },
  "mistralai/mistral-small-3":             { provider: "openrouter", input: 0.075, output: 0.20  },
  "mistralai/mistral-nemo":                { provider: "openrouter", input: 0.02,  output: 0.03  },
  "mistralai/mixtral-8x22b-instruct":      { provider: "openrouter", input: 2.00,  output: 6.00  },
  "mistralai/mixtral-8x7b-instruct":       { provider: "openrouter", input: 0.24,  output: 0.24  },
  "mistralai/codestral-2508":              { provider: "openrouter", input: 0.30,  output: 0.90  },
  "mistralai/devstral-2512":               { provider: "openrouter", input: 0.40,  output: 2.00  },

  // ── OpenRouter — Google Gemma ─────────────────────────────────────────────
  "google/gemma-4-31b-it":                 { provider: "openrouter", input: 0.12,  output: 0.37  },
  "google/gemma-4-26b-a4b-it":             { provider: "openrouter", input: 0.06,  output: 0.33  },
  "google/gemma-3-27b-it":                 { provider: "openrouter", input: 0.08,  output: 0.16  },
  "google/gemma-3-12b-it":                 { provider: "openrouter", input: 0.04,  output: 0.13  },
  "google/gemma-2-27b-it":                 { provider: "openrouter", input: 0.65,  output: 0.65  },

  // ── OpenRouter — DeepSeek ─────────────────────────────────────────────────
  "deepseek/deepseek-r1-0528":             { provider: "openrouter", input: 0.50,  output: 2.15  },
  "deepseek/deepseek-r1":                  { provider: "openrouter", input: 0.70,  output: 2.50  },
  "deepseek/deepseek-v3.2":               { provider: "openrouter", input: 0.229, output: 0.343 },
  "deepseek/deepseek-v4-pro":             { provider: "openrouter", input: 0.435, output: 0.87  },
  "deepseek/deepseek-v4-flash":           { provider: "openrouter", input: 0.098, output: 0.197 },
  "deepseek/deepseek-chat-v3-0324":       { provider: "openrouter", input: 0.20,  output: 0.77  },
  "deepseek/deepseek-r1-distill-llama-70b": { provider: "openrouter", input: 0.70, output: 0.80 },
  "deepseek/deepseek-r1-distill-qwen-32b": { provider: "openrouter", input: 0.29,  output: 0.29 },

  // ── OpenRouter — Qwen3 ────────────────────────────────────────────────────
  "qwen/qwen3-235b-a22b":                  { provider: "openrouter", input: 0.455, output: 1.82  },
  "qwen/qwen3-32b":                        { provider: "openrouter", input: 0.08,  output: 0.28  },
  "qwen/qwen3-30b-a3b":                    { provider: "openrouter", input: 0.09,  output: 0.45  },
  "qwen/qwen3-14b":                        { provider: "openrouter", input: 0.10,  output: 0.24  },
  "qwen/qwen3-8b":                         { provider: "openrouter", input: 0.05,  output: 0.40  },
  "qwen/qwen3-coder":                      { provider: "openrouter", input: 0.22,  output: 1.80  },
  "qwen/qwen3-max":                        { provider: "openrouter", input: 0.78,  output: 3.90  },

  // ── OpenRouter — Qwen2.5 ──────────────────────────────────────────────────
  "qwen/qwen-2.5-72b-instruct":            { provider: "openrouter", input: 0.36,  output: 0.40  },
  "qwen/qwen-2.5-7b-instruct":             { provider: "openrouter", input: 0.04,  output: 0.10  },
  "qwen/qwen-2.5-coder-32b-instruct":      { provider: "openrouter", input: 0.66,  output: 1.00  },
  "qwen/qwen-plus":                        { provider: "openrouter", input: 0.26,  output: 0.78  },

  // ── OpenRouter — Microsoft Phi ────────────────────────────────────────────
  "microsoft/phi-4":                       { provider: "openrouter", input: 0.065, output: 0.14  },
  "microsoft/phi-4-mini-instruct":         { provider: "openrouter", input: 0.08,  output: 0.35  },
  "microsoft/phi-3.5-mini-128k-instruct":  { provider: "openrouter", input: 0.10,  output: 0.10  },
  "microsoft/phi-3-medium-128k-instruct":  { provider: "openrouter", input: 0.14,  output: 0.14  },

  // ── OpenRouter — xAI Grok ─────────────────────────────────────────────────
  "x-ai/grok-4.20":                        { provider: "openrouter", input: 1.25,  output: 2.50  },
  "x-ai/grok-4.3":                         { provider: "openrouter", input: 1.25,  output: 2.50  },
  "x-ai/grok-4.20-multi-agent":            { provider: "openrouter", input: 2.00,  output: 6.00  },

  // ── OpenRouter — Amazon Nova ──────────────────────────────────────────────
  "amazon/nova-premier-v1":                { provider: "openrouter", input: 2.50,  output: 12.50 },
  "amazon/nova-pro-v1":                    { provider: "openrouter", input: 0.80,  output: 3.20  },
  "amazon/nova-lite-v1":                   { provider: "openrouter", input: 0.06,  output: 0.24  },
  "amazon/nova-micro-v1":                  { provider: "openrouter", input: 0.035, output: 0.14  },

  // ── OpenRouter — Perplexity Sonar ────────────────────────────────────────
  "perplexity/sonar-pro":                  { provider: "openrouter", input: 3.00,  output: 15.00 },
  "perplexity/sonar":                      { provider: "openrouter", input: 1.00,  output: 1.00  },

  // ── OpenRouter — Cohere ───────────────────────────────────────────────────
  "cohere/command-a":                      { provider: "openrouter", input: 2.50,  output: 10.00 },
  "cohere/command-r-plus-08-2024":         { provider: "openrouter", input: 2.50,  output: 10.00 },
  "cohere/command-r-08-2024":              { provider: "openrouter", input: 0.15,  output: 0.60  },

  // ── OpenRouter — NVIDIA Nemotron ──────────────────────────────────────────
  "nvidia/nemotron-3-ultra-550b-a55b":     { provider: "openrouter", input: 0.50,  output: 2.50  },
  "nvidia/nemotron-3-super-120b-a12b":     { provider: "openrouter", input: 0.09,  output: 0.45  },

  // ── OpenRouter — Free models ($0, :free suffix) ───────────────────────────
  // 27 free models as of July 2026 per live OR catalog
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

  // ── OpenRouter — paid OSS models ─────────────────────────────────────────
  "openai/gpt-oss-120b":                          { provider: "openrouter", input: 0.039, output: 0.18 },
  "openai/gpt-oss-20b":                           { provider: "openrouter", input: 0.029, output: 0.14 },

  // ── Groq ──────────────────────────────────────────────────────────────────
  // Pricing: https://groq.com/pricing (June 2026)
  "llama-3.1-8b-instant":              { provider: "groq", input: 0.05,  output: 0.08  },
  "llama-3.3-70b-versatile":           { provider: "groq", input: 0.59,  output: 0.79  },
  "llama-3.1-70b-versatile":           { provider: "groq", input: 0.59,  output: 0.79  },
  "mixtral-8x7b-32768":                { provider: "groq", input: 0.24,  output: 0.24  },
  "gemma2-9b-it":                      { provider: "groq", input: 0.20,  output: 0.20  },
  "deepseek-r1-distill-llama-70b":     { provider: "groq", input: 0.75,  output: 0.99  },

  // ── xAI ───────────────────────────────────────────────────────────────────
  // Pricing: https://x.ai/api (June 2026)
  "grok-3":                            { provider: "xai",  input: 3.00,  output: 15.00 },
  "grok-3-mini":                       { provider: "xai",  input: 0.30,  output: 0.50  },
  "grok-3-fast":                       { provider: "xai",  input: 5.00,  output: 25.00 },
  "grok-2-1212":                       { provider: "xai",  input: 2.00,  output: 10.00 },
  "grok-2-vision-1212":                { provider: "xai",  input: 2.00,  output: 10.00 },

  // ── Fireworks AI ──────────────────────────────────────────────────────────
  // Model IDs use full account-namespaced paths; prefix matching handles variants.
  // Pricing: https://fireworks.ai/pricing (June 2026)
  "accounts/fireworks/models/llama-v3p1-405b-instruct": { provider: "fireworks", input: 3.00, output: 3.00 },
  "accounts/fireworks/models/llama-v3p1-70b-instruct":  { provider: "fireworks", input: 0.90, output: 0.90 },
  "accounts/fireworks/models/llama-v3p2-3b-instruct":   { provider: "fireworks", input: 0.10, output: 0.10 },
  "accounts/fireworks/models/deepseek-r1":               { provider: "fireworks", input: 8.00, output: 8.00 },
  "accounts/fireworks/models/qwen2p5-72b-instruct":      { provider: "fireworks", input: 0.90, output: 0.90 },

  // ── Together AI ───────────────────────────────────────────────────────────
  // Pricing: https://www.together.ai/pricing (June 2026)
  "meta-llama/Llama-3.3-70B-Instruct-Turbo":  { provider: "together", input: 0.88, output: 0.88 },
  "meta-llama/Llama-3.1-8B-Instruct-Turbo":   { provider: "together", input: 0.18, output: 0.18 },
  "deepseek-ai/DeepSeek-R1":                  { provider: "together", input: 7.00, output: 7.00 },
  "Qwen/Qwen2.5-72B-Instruct-Turbo":          { provider: "together", input: 1.20, output: 1.20 },
  "mistralai/Mixtral-8x7B-Instruct-v0.1":     { provider: "together", input: 0.60, output: 0.60 },

  // ── Perplexity ────────────────────────────────────────────────────────────
  // Sonar search models append citations to responses (non-OpenAI field; passed through).
  // Tool calling is blocked at the gateway level for Perplexity targets.
  // Pricing: https://docs.perplexity.ai/docs/pricing (June 2026)
  "sonar":               { provider: "perplexity", input: 1.00, output: 1.00  },
  "sonar-pro":           { provider: "perplexity", input: 3.00, output: 15.00 },
  "sonar-reasoning":     { provider: "perplexity", input: 1.00, output: 5.00  },
  "sonar-reasoning-pro": { provider: "perplexity", input: 2.00, output: 8.00  },
  "r1-1776":             { provider: "perplexity", input: 2.00, output: 8.00  },

  // ── AWS Bedrock — Anthropic Claude ────────────────────────────────────────
  // Model IDs use Bedrock's full namespaced format with version suffix (:0 = latest).
  // Cross-region inference profiles (e.g. us.anthropic.*) are stripped to base IDs
  // by normalizeModelName() before lookup.
  // Pricing: https://aws.amazon.com/bedrock/pricing (June 2026)
  "anthropic.claude-opus-4-5":                 { provider: "bedrock", input: 15.00, output: 75.00 },
  "anthropic.claude-sonnet-4-6":               { provider: "bedrock", input:  3.00, output: 15.00 },
  "anthropic.claude-haiku-4-5":                { provider: "bedrock", input:  1.00, output:  5.00 },
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { provider: "bedrock", input:  3.00, output: 15.00 },
  "anthropic.claude-3-5-haiku-20241022-v1:0":  { provider: "bedrock", input:  0.80, output:  4.00 },
  "anthropic.claude-3-opus-20240229-v1:0":     { provider: "bedrock", input: 15.00, output: 75.00 },

  // ── AWS Bedrock — Amazon Nova ──────────────────────────────────────────────
  "amazon.nova-premier-v1:0":                  { provider: "bedrock", input:  2.50, output: 12.50 },
  "amazon.nova-pro-v1:0":                      { provider: "bedrock", input:  0.80, output:  3.20 },
  "amazon.nova-lite-v1:0":                     { provider: "bedrock", input:  0.06, output:  0.24 },
  "amazon.nova-micro-v1:0":                    { provider: "bedrock", input: 0.035, output:  0.14 },

  // ── AWS Bedrock — Meta Llama 3 ────────────────────────────────────────────
  "meta.llama3-3-70b-instruct-v1:0":           { provider: "bedrock", input:  0.72, output:  0.72 },
  "meta.llama3-2-90b-instruct-v1:0":           { provider: "bedrock", input:  2.00, output:  2.00 },
  "meta.llama3-1-8b-instruct-v1:0":            { provider: "bedrock", input:  0.30, output:  0.30 },
  "meta.llama3-1-70b-instruct-v1:0":           { provider: "bedrock", input:  0.72, output:  0.72 },

  // ── AWS Bedrock — Mistral ──────────────────────────────────────────────────
  "mistral.mistral-large-2402-v1:0":           { provider: "bedrock", input:  4.00, output: 12.00 },
  "mistral.mistral-small-2402-v1:0":           { provider: "bedrock", input:  1.00, output:  3.00 },

  // ── AWS Bedrock — Cohere ──────────────────────────────────────────────────
  "cohere.command-r-plus-v1:0":                { provider: "bedrock", input:  3.00, output: 15.00 },
  "cohere.command-r-v1:0":                     { provider: "bedrock", input:  0.50, output:  1.50 },

  // ── Mistral AI (direct, api.mistral.ai) ────────────────────────────────────
  // Stable stems prefix-match both -latest aliases and dated IDs
  // (e.g. "mistral-large" matches "mistral-large-latest" and "mistral-large-2411").
  // Distinct from OpenRouter "mistralai/*" and Bedrock "mistral.*" keys.
  // Pricing: https://mistral.ai/pricing (June 2026)
  "mistral-large":        { provider: "mistral", input: 2.00,   output: 6.00  },
  "mistral-medium":       { provider: "mistral", input: 0.40,   output: 2.00  },
  "mistral-small":        { provider: "mistral", input: 0.10,   output: 0.30  },
  "magistral-medium":     { provider: "mistral", input: 2.00,   output: 5.00  },
  "magistral-small":      { provider: "mistral", input: 0.50,   output: 1.50  },
  "codestral":            { provider: "mistral", input: 0.30,   output: 0.90  },
  "devstral-medium":      { provider: "mistral", input: 0.40,   output: 2.00  },
  "devstral-small":       { provider: "mistral", input: 0.10,   output: 0.30  },
  "ministral-8b":         { provider: "mistral", input: 0.10,   output: 0.10  },
  "ministral-3b":         { provider: "mistral", input: 0.04,   output: 0.04  },
  "open-mistral-nemo":    { provider: "mistral", input: 0.15,   output: 0.15  },
  "pixtral-large":        { provider: "mistral", input: 2.00,   output: 6.00  },

  // ── Cerebras (api.cerebras.ai) — ultra-fast inference, OpenAI-compatible ────
  // Bare model IDs (no -versatile/-instant suffix) distinguish these from Groq's.
  // Pricing: https://www.cerebras.ai/pricing (June 2026, billed per-token)
  "llama-3.3-70b":                    { provider: "cerebras", input: 0.85,  output: 1.20 },
  "llama3.1-8b":                      { provider: "cerebras", input: 0.10,  output: 0.10 },
  "llama-4-scout-17b-16e-instruct":   { provider: "cerebras", input: 0.65,  output: 0.85 },
  "qwen-3-32b":                       { provider: "cerebras", input: 0.40,  output: 0.80 },

  // ── Nebius AI Studio (api.studio.nebius.ai) — OpenAI-compatible ─────────────
  // HF-style IDs; case-sensitive prefix match keeps them distinct from
  // OpenRouter's lowercase "meta-llama/llama-*". (DeepSeek-R1 on Nebius shares
  // the Together-tagged "deepseek-ai/DeepSeek-R1" key — known multi-provider id.)
  // Pricing: https://nebius.com/prices-ai-studio (June 2026, base tier)
  "meta-llama/Meta-Llama-3.1-405B-Instruct": { provider: "nebius", input: 1.00, output: 3.00 },
  "meta-llama/Meta-Llama-3.1-70B-Instruct":  { provider: "nebius", input: 0.13, output: 0.40 },
  "meta-llama/Meta-Llama-3.1-8B-Instruct":   { provider: "nebius", input: 0.03, output: 0.09 },
  "Qwen/Qwen3-235B-A22B":                    { provider: "nebius", input: 0.20, output: 0.60 },
  "deepseek-ai/DeepSeek-V3":                 { provider: "nebius", input: 0.50, output: 1.50 },

  // ── Cohere (direct, api.cohere.ai/compatibility/v1) ─────────────────────────
  // Stems prefix-match dated IDs (e.g. "command-a" → "command-a-03-2025").
  // Pricing: https://cohere.com/pricing (June 2026)
  "command-a":        { provider: "cohere", input: 2.50,   output: 10.00 },
  "command-r-plus":   { provider: "cohere", input: 2.50,   output: 10.00 },
  "command-r7b":      { provider: "cohere", input: 0.0375, output: 0.15  },
  "command-r":        { provider: "cohere", input: 0.15,   output: 0.60  },
};

const _SORTED_KEYS = Object.keys(MODEL_PRICING).sort((a, b) => b.length - a.length);

function resolveModel(model: string) {
  if (MODEL_PRICING[model]) return MODEL_PRICING[model];
  // Longest-prefix match for versioned IDs (e.g. "gpt-4o-2024-08-06" → "gpt-4o")
  for (const key of _SORTED_KEYS) {
    if (model.startsWith(key)) return MODEL_PRICING[key];
  }
  return null;
}

/**
 * Normalize a versioned model name to its canonical pricing-table key.
 * e.g. "gpt-4o-mini-2024-07-18" → "gpt-4o-mini"
 *      "gpt-4o-mini"            → "gpt-4o-mini"  (already canonical)
 *      "my-custom-deployment"   → "my-custom-deployment" (unknown, unchanged)
 */
export function normalizeModelName(model: string): string {
  if (MODEL_PRICING[model]) return model;
  // Strip Bedrock cross-region inference profile prefixes (e.g. "us.anthropic.claude-..." → "anthropic.claude-...")
  const crossRegionPrefixRe = /^(?:us|eu|ap(?:-(?:northeast|southeast)-\d+)?)\.(.+)$/i;
  const crMatch = crossRegionPrefixRe.exec(model);
  if (crMatch) {
    const stripped = crMatch[1]!;
    if (MODEL_PRICING[stripped]) return stripped;
    for (const key of _SORTED_KEYS) {
      if (stripped.startsWith(key)) return key;
    }
  }
  for (const key of _SORTED_KEYS) {
    if (model.startsWith(key)) return key;
  }
  return model;
}

export function planToTtlDays(plan: string): number {
  const map: Record<string, number> = {
    // Legacy DB names
    starter: 90, growth: 180, scale: 365,
    // Current tier names
    free: 30, solo: 60, startup: 180, enterprise: 365,
    // Aliases kept for backwards compat
    developer: 60, builder: 90, team: 180,
  };
  return map[plan] ?? 30;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0,
): number {
  const p = resolveModel(model);
  if (!p) return 0;
  const uncachedInput = Math.max(0, inputTokens - cachedTokens);
  return (
    (uncachedInput * p.input) / 1_000_000 +
    (cachedTokens * (p.cached_input ?? p.input)) / 1_000_000 +
    (outputTokens * p.output) / 1_000_000
  );
}
