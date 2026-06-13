export type GatewayProvider =
  | "openai" | "anthropic" | "google" | "azure_openai" | "openrouter"
  | "groq" | "xai" | "fireworks" | "together" | "perplexity"
  | "mistral" | "cerebras" | "nebius" | "cohere"
  | "bedrock";
export type LocalProvider   = "ollama" | "openai_compatible";
export type AnyProvider     = GatewayProvider | LocalProvider;

interface ProviderConfig {
  baseUrl:         string;
  customEndpoint?: string;
  /** Transform headers before forwarding to upstream */
  buildHeaders: (providerKey: string, incomingHeaders: Headers) => Record<string, string>;
}

const CONFIGS: Record<GatewayProvider, ProviderConfig> = {
  openai: {
    baseUrl: "https://api.openai.com",
    buildHeaders: (key, incoming) => ({
      "Authorization":  `Bearer ${key}`,
      "Content-Type":   incoming.get("content-type") ?? "application/json",
      "OpenAI-Beta":    incoming.get("openai-beta")  ?? "",
    }),
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    buildHeaders: (key, incoming) => ({
      "x-api-key":         key,
      "anthropic-version": incoming.get("anthropic-version") ?? "2023-06-01",
      "Content-Type":      incoming.get("content-type")      ?? "application/json",
    }),
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com",
    buildHeaders: (_key, incoming) => ({
      "Content-Type": incoming.get("content-type") ?? "application/json",
    }),
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
      "HTTP-Referer":  "https://useprism.dev",
      "X-Title":       "Prism",
    }),
  },

  // Azure OpenAI: endpoint + auth header are both different from standard OpenAI.
  // baseUrl is a placeholder — the actual URL is built in buildUpstreamUrl()
  // using the custom_endpoint stored on the provider key.
  azure_openai: {
    baseUrl: "",
    buildHeaders: (key, incoming) => ({
      "api-key":      key,               // Azure uses api-key, not Bearer
      "Content-Type": incoming.get("content-type") ?? "application/json",
    }),
  },

  // ── OpenAI-compatible cloud providers ────────────────────────────────────
  // All use Bearer auth and the OpenAI wire format; no request/response
  // normalisation is needed when routing to or from these providers.
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  fireworks: {
    baseUrl: "https://api.fireworks.ai/inference/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  perplexity: {
    baseUrl: "https://api.perplexity.ai",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  cerebras: {
    baseUrl: "https://api.cerebras.ai/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  nebius: {
    baseUrl: "https://api.studio.nebius.ai/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },
  // Cohere exposes an OpenAI-compatible surface at /compatibility/v1.
  cohere: {
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    buildHeaders: (key, incoming) => ({
      "Authorization": `Bearer ${key}`,
      "Content-Type":  incoming.get("content-type") ?? "application/json",
    }),
  },

  // AWS Bedrock: baseUrl and buildHeaders are intentional no-ops.
  // Auth (SigV4) and HTTP execution are handled by bedrockFetch() in lib/gateway/bedrock.ts,
  // which intercepts the request before the standard fetch() path in route.ts.
  bedrock: {
    baseUrl: "",
    buildHeaders: (_key, _incoming) => ({}),
  },
};

// Default Azure OpenAI API version. Operators can override per-request via
// the x-prism-azure-api-version header (forwarded through the Prism key).
const AZURE_API_VERSION = "2024-05-13";

/**
 * Build a provider config for local / self-hosted providers.
 * Both ollama and openai_compatible use OpenAI-format request bodies,
 * so no cross-provider normalisation is needed.
 */
function buildLocalConfig(customEndpoint: string, providerType: LocalProvider): ProviderConfig {
  return {
    baseUrl: customEndpoint || (providerType === "ollama" ? "http://localhost:11434" : ""),
    buildHeaders: (key, incoming) => ({
      "Content-Type":  incoming.get("content-type") ?? "application/json",
      // Ollama doesn't require auth; openai_compatible may need a bearer token
      ...(key ? { "Authorization": `Bearer ${key}` } : {}),
    }),
  };
}

export function getProviderConfig(provider: string, customEndpoint?: string): ProviderConfig {
  if (provider === "ollama" || provider === "openai_compatible") {
    return buildLocalConfig(customEndpoint ?? "", provider as LocalProvider);
  }
  const cfg = CONFIGS[provider as GatewayProvider];
  if (!cfg) throw new Error(`Unknown provider: ${provider}`);
  return cfg;
}

/**
 * Build the full upstream URL.
 *
 * Azure format:
 *   {customEndpoint}/openai/deployments/{model}{path}?api-version={version}
 * The `model` value in the request body doubles as the deployment name.
 *
 * Google: API key appended as query param.
 * All others: baseUrl + path.
 */
export function buildUpstreamUrl(
  provider:       string,
  path:           string,
  providerKey:    string,
  customEndpoint?: string,
  /** Azure: deployment name = model name from the request body */
  modelName?:     string,
  /** Optional Azure API version override */
  azureApiVersion?: string,
): string {
  if (provider === "azure_openai") {
    const endpoint = (customEndpoint ?? "").replace(/\/$/, "");
    if (!endpoint) throw new Error("Azure OpenAI requires a custom_endpoint (resource URL)");
    const deployment = modelName ?? "";
    const version    = azureApiVersion ?? AZURE_API_VERSION;
    const base       = `${endpoint}/openai/deployments/${deployment}${path}`;
    const sep        = base.includes("?") ? "&" : "?";
    return `${base}${sep}api-version=${version}`;
  }

  const { baseUrl } = getProviderConfig(provider, customEndpoint);
  const url = `${baseUrl}${path}`;
  if (provider === "google") {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(providerKey)}`;
  }
  return url;
}
