/**
 * Tier 2 Semantic Cache — vector similarity via @upstash/vector.
 *
 * Embeds the last user message with OpenAI's text-embedding-3-small and
 * queries Upstash Vector for the closest cached response scoped to the org.
 * A result whose cosine similarity meets the org's `similarityThreshold`
 * (org.similarity_threshold, default 0.92) is returned as a cache hit, so
 * paraphrased-but-equivalent prompts can reuse a prior response.
 *
 * Requires UPSTASH_VECTOR_REST_URL/TOKEN and OPENAI_API_KEY. Both read and
 * write are no-ops when either is absent, and never throw — semantic caching
 * must never break the gateway hot path.
 */

import { Index } from "@upstash/vector";
import type { CachedEntry } from "./cache";

export interface SemanticCacheConfig {
  similarityThreshold: number;  // 0-1, e.g. 0.92
  embeddingModel:      string;  // "text-embedding-3-small"
}

/** A semantic cache hit, with the debug signal needed for response headers. */
export interface SemanticHit {
  entry:           CachedEntry;
  similarity:      number;   // cosine similarity of the matched entry (0-1)
  embeddingTokens: number;   // tokens the embedding call consumed (cost of the lookup)
}

interface ChatMessage {
  role?:    string;
  content?: unknown;
}

let cachedIndex: Index | undefined;

function getVectorIndex(): Index | null {
  const url   = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) return null;
  if (!cachedIndex) cachedIndex = new Index({ url, token });
  return cachedIndex;
}

/**
 * Strip characters that could break the vector filter DSL or inject extra
 * clauses. Partition values originate from a client header (`x-prism-cache-key`),
 * so they must never be interpolated raw into a filter string.
 */
function sanitizeFilterValue(v: string): string {
  return v.replace(/[^a-zA-Z0-9_:.\-]/g, "").slice(0, 128);
}

/**
 * Returns the text content of the last user message, or null if there is
 * none or it has no extractable text. Handles plain string content and
 * multi-part array content (`[{type: "text", text: "..."}]`).
 */
export function extractQueryText(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as ChatMessage | undefined;
    if (msg?.role !== "user") continue;

    const { content } = msg;
    if (typeof content === "string") {
      const trimmed = content.trim();
      return trimmed || null;
    }
    if (Array.isArray(content)) {
      const text = content
        .filter((part): part is { type: string; text: string } =>
          !!part && typeof part === "object" &&
          (part as { type?: unknown }).type === "text" &&
          typeof (part as { text?: unknown }).text === "string")
        .map(part => part.text)
        .join("\n")
        .trim();
      return text || null;
    }
    return null;
  }
  return null;
}

/**
 * Embed text via OpenAI. Returns the vector plus the tokens the call consumed,
 * or null if OPENAI_API_KEY is unset or the call fails.
 */
async function embed(text: string, model: string): Promise<{ vector: number[]; tokens: number } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (!res.ok) return null;

    const json = await res.json() as {
      data?:  Array<{ embedding?: number[] }>;
      usage?: { total_tokens?: number; prompt_tokens?: number };
    };
    const vector = json.data?.[0]?.embedding;
    if (!vector) return null;
    return { vector, tokens: json.usage?.total_tokens ?? json.usage?.prompt_tokens ?? 0 };
  } catch {
    return null;
  }
}

/**
 * Look up a semantically similar cached response for this org (optionally scoped
 * to a partition). Returns the hit plus its similarity score and the embedding
 * cost, or null on a miss, error, or missing config — never throws.
 */
export async function semanticCacheGet(
  orgId:     string,
  messages:  unknown[],
  config:    SemanticCacheConfig,
  partition?: string,
): Promise<SemanticHit | null> {
  try {
    const index = getVectorIndex();
    if (!index) return null;

    const query = extractQueryText(messages);
    if (!query) return null;

    const embedded = await embed(query, config.embeddingModel);
    if (!embedded) return null;

    // Scope to the partition when one is supplied. Legacy entries written without
    // a partition are intentionally not matched by partitioned lookups.
    const part   = sanitizeFilterValue(partition ?? "");
    const filter = part
      ? `org_id = '${orgId}' AND partition = '${part}'`
      : `org_id = '${orgId}'`;

    const results = await index.query({
      vector:          embedded.vector,
      topK:            1,
      includeMetadata: true,
      filter,
    });

    const top = results[0];
    if (!top || top.score < config.similarityThreshold || !top.metadata) return null;

    return {
      entry:           top.metadata as unknown as CachedEntry,
      similarity:      top.score,
      embeddingTokens: embedded.tokens,
    };
  } catch {
    return null;
  }
}

/**
 * Store a response in the semantic cache, embedding the prompt as the
 * vector key. No-ops on missing config or errors — never throws.
 */
export async function semanticCacheSet(
  orgId:     string,
  messages:  unknown[],
  response:  Record<string, unknown>,
  config:    SemanticCacheConfig,
  partition?: string,
): Promise<void> {
  try {
    const index = getVectorIndex();
    if (!index) return;

    const query = extractQueryText(messages);
    if (!query) return;

    const embedded = await embed(query, config.embeddingModel);
    if (!embedded) return;

    const usage = response.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const entry: CachedEntry = {
      response,
      model:        typeof response.model === "string" ? response.model : "",
      inputTokens:  usage?.prompt_tokens ?? 0,
      outputTokens: usage?.completion_tokens ?? 0,
      cachedAt:     Date.now(),
    };

    await index.upsert({
      id:       crypto.randomUUID(),
      vector:   embedded.vector,
      metadata: { ...entry, org_id: orgId, partition: sanitizeFilterValue(partition ?? "") },
    });
  } catch { /* never block the gateway */ }
}

/**
 * Purge all semantic (Tier 2) cache entries for an org. Best-effort; never
 * throws. Returns false when no vector index is configured (nothing to purge).
 */
export async function semanticCacheInvalidate(orgId: string): Promise<boolean> {
  try {
    const index = getVectorIndex();
    if (!index) return false;
    await index.delete({ filter: `org_id = '${orgId}'` });
    return true;
  } catch {
    return false;
  }
}
