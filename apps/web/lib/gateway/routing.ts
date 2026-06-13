/**
 * Model routing & fallback for the Prism gateway.
 *
 * V2: supports cross-provider routing (gpt-4o â†’ claude-3-5-haiku when OpenAI is down).
 * Each fallback candidate carries its provider so the gateway can resolve the correct
 * provider key and request format.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GatewayProvider } from "./upstream";

export interface FallbackCandidate {
  model:    string;
  provider: GatewayProvider | string;  // string covers ollama / openai_compatible
  weight?:  number;                    // 0-100 relative weight; absent = unweighted (legacy)
}

/**
 * Weighted random selection proportional to each item's `weight` field.
 * Falls back to uniform random when all weights are 0 or absent.
 */
export function weightedSample<T extends { weight?: number }>(items: T[]): T {
  if (items.length === 0) throw new RangeError("weightedSample: empty array");
  if (items.length === 1) return items[0]!;

  const weights = items.map(c => Math.max(0, c.weight ?? 1));
  const total   = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return items[Math.floor(Math.random() * items.length)]!;

  let rand = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    rand -= weights[i]!;
    if (rand <= 0) return items[i]!;
  }
  return items[items.length - 1]!;
}

// â”€â”€ Default fallback chains â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Same-provider fallbacks first (lower latency, same auth); cross-provider last resort.

export const DEFAULT_ROUTING: Record<string, FallbackCandidate[]> = {
  // OpenAI
  "gpt-4o": [
    { model: "gpt-4o-mini",               provider: "openai" },
    { model: "claude-3-5-haiku-20241022",  provider: "anthropic" },  // cross-provider
  ],
  "gpt-4-turbo": [
    { model: "gpt-4o",                    provider: "openai" },
    { model: "gpt-4o-mini",               provider: "openai" },
  ],
  "gpt-4-turbo-preview": [
    { model: "gpt-4o",                    provider: "openai" },
    { model: "gpt-4o-mini",               provider: "openai" },
  ],
  // Anthropic
  "claude-3-opus-20240229": [
    { model: "claude-3-5-sonnet-20241022", provider: "anthropic" },
    { model: "claude-3-5-haiku-20241022",  provider: "anthropic" },
    { model: "gpt-4o",                     provider: "openai" },     // cross-provider
  ],
  "claude-3-5-sonnet-20241022": [
    { model: "claude-3-5-haiku-20241022",  provider: "anthropic" },
    { model: "gpt-4o-mini",               provider: "openai" },     // cross-provider
  ],
  // Google
  "gemini-1.5-pro": [
    { model: "gemini-1.5-flash",           provider: "google" },
    { model: "gpt-4o-mini",               provider: "openai" },     // cross-provider
  ],
  // Groq
  "llama-3.3-70b-versatile": [
    { model: "llama-3.1-70b-versatile",    provider: "groq"   },
    { model: "gpt-4o-mini",               provider: "openai" },     // cross-provider
  ],
  "llama-3.1-8b-instant": [
    { model: "gpt-4o-mini",               provider: "openai" },     // cross-provider
  ],
  // xAI
  "grok-3": [
    { model: "grok-3-mini",               provider: "xai"    },
    { model: "gpt-4o",                    provider: "openai" },     // cross-provider
  ],
  "grok-3-mini": [
    { model: "gpt-4o-mini",               provider: "openai" },     // cross-provider
  ],
  // AWS Bedrock — Claude
  "anthropic.claude-3-5-sonnet-20241022-v2:0": [
    { model: "anthropic.claude-3-5-haiku-20241022-v1:0", provider: "bedrock"   },
    { model: "claude-3-5-sonnet-20241022",                provider: "anthropic" },  // cross-provider
  ],
  "anthropic.claude-3-5-haiku-20241022-v1:0": [
    { model: "claude-3-5-haiku-20241022",                 provider: "anthropic" },  // cross-provider
  ],
  // AWS Bedrock — Amazon Nova
  "amazon.nova-pro-v1:0": [
    { model: "amazon.nova-lite-v1:0",                     provider: "bedrock"  },
    { model: "gpt-4o-mini",                               provider: "openai"   },  // cross-provider
  ],
  "amazon.nova-lite-v1:0": [
    { model: "amazon.nova-micro-v1:0",                    provider: "bedrock"  },
    { model: "gpt-4o-mini",                               provider: "openai"   },  // cross-provider
  ],
};

/** HTTP status codes that trigger a fallback retry */
export const FALLBACK_TRIGGER_CODES = new Set([429, 503, 500, 502]);

type RuleRow = {
  fallback_candidates?: FallbackCandidate[] | null;
  fallback_models?:    string[] | null;
  trigger_on_codes:    number[];
};

function rowToCandidates(data: RuleRow, provider: GatewayProvider): FallbackCandidate[] {
  if (data.fallback_candidates?.length) return data.fallback_candidates;
  if (data.fallback_models?.length) return data.fallback_models.map((m) => ({ model: m, provider }));
  return [];
}

/**
 * Fetch routing rules for a model, with two-pass resolution:
 *   1. Key-specific rule  (api_key_id = apiKeyId)  â€” most precise
 *   2. Org-wide rule      (api_key_id IS NULL)      â€” org default
 *   3. Built-in DEFAULT_ROUTING                     â€” last resort
 *
 * Pass apiKeyId to enable per-key rule scoping.
 */
export async function getFallbackCandidates(
  orgId:    string,
  model:    string,
  provider: GatewayProvider,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  apiKeyId?: string,
): Promise<{ candidates: FallbackCandidate[]; triggerCodes: Set<number> }> {
  const select = "fallback_candidates, fallback_models, trigger_on_codes";
  try {
    // Pass 1: key-specific rule
    if (apiKeyId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("model_routing_rules" as any)
        .select(select)
        .eq("org_id", orgId)
        .eq("api_key_id", apiKeyId)
        .eq("primary_model", model)
        .eq("is_active", true)
        .maybeSingle() as { data: RuleRow | null };

      if (data) {
        return {
          candidates:   rowToCandidates(data, provider),
          triggerCodes: new Set(data.trigger_on_codes ?? [429, 503]),
        };
      }
    }

    // Pass 2: org-wide rule
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (supabase as any)
      .from("model_routing_rules" as any)
      .select(select)
      .eq("org_id", orgId)
      .is("api_key_id", null)
      .eq("primary_model", model)
      .eq("is_active", true)
      .maybeSingle() as { data: RuleRow | null };

    if (data) {
      return {
        candidates:   rowToCandidates(data, provider),
        triggerCodes: new Set(data.trigger_on_codes ?? [429, 503]),
      };
    }
  } catch {
    // DB unavailable â€” fall through to defaults
  }

  return {
    candidates:   DEFAULT_ROUTING[model] ?? [],
    triggerCodes: FALLBACK_TRIGGER_CODES,
  };
}

/** @deprecated Use getFallbackCandidates â€” kept for backward compat */
export async function getFallbackModels(
  orgId:    string,
  model:    string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
): Promise<{ fallbacks: string[]; triggerCodes: Set<number> }> {
  const { candidates, triggerCodes } = await getFallbackCandidates(orgId, model, "openai", supabase);
  return { fallbacks: candidates.map((c) => c.model), triggerCodes };
}
