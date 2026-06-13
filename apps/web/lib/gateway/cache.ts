/**
 * Gateway prompt cache — Tier 1: exact-match via SHA-256 + Upstash Redis.
 *
 * Only deterministic requests are cached (temperature ≤ 0.1 or unset).
 * Streaming requests are NOT cached (response body can't be replayed easily).
 *
 * Cache key: SHA-256 of (orgId + model + temperature + messages JSON)
 * Cache TTL:  configurable per org (default 1 hour)
 *
 * Tier 2 (semantic similarity via @upstash/vector) is scaffolded in
 * semantic-cache.ts but not enabled by default.
 */
import { createHash } from "crypto";
import { redis } from "@/lib/upstash/redis";
import { createAdminClient } from "@/lib/supabase/server";

export interface CachedEntry {
  response:     object;      // full upstream JSON response body
  model:        string;
  inputTokens:  number;
  outputTokens: number;
  cachedAt:     number;      // unix ms
}

export interface OrgCacheConfig {
  enabled:             boolean;
  ttlSeconds:          number;
  mode:                "exact" | "semantic";
  similarityThreshold: number;
  // Skip caching when a conversation has MORE than this many messages
  // (long multi-turn chats churn and rarely repeat). 0 = no limit.
  conversationHistoryThreshold: number;
}

// In-memory config cache to avoid a DB round-trip on every gateway request
const CONFIG_CACHE = new Map<string, { config: OrgCacheConfig; expiresAt: number }>();
const CONFIG_TTL_MS = 60_000; // 60 seconds

export async function getOrgCacheConfig(orgId: string): Promise<OrgCacheConfig> {
  const now = Date.now();
  const hit  = CONFIG_CACHE.get(orgId);
  if (hit && hit.expiresAt > now) return hit.config;

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from("organizations")
      .select("cache_enabled, cache_ttl_seconds, cache_mode, similarity_threshold, cache_conversation_history_threshold")
      .eq("id", orgId)
      .maybeSingle() as {
        data: {
          cache_enabled?:       boolean;
          cache_ttl_seconds?:   number;
          cache_mode?:          string;
          similarity_threshold?: number;
          cache_conversation_history_threshold?: number;
        } | null;
      };

    const config: OrgCacheConfig = {
      enabled:             data?.cache_enabled    ?? false,
      ttlSeconds:          data?.cache_ttl_seconds ?? 3600,
      mode:                (data?.cache_mode as "exact" | "semantic") ?? "exact",
      similarityThreshold: data?.similarity_threshold ?? 0.92,
      conversationHistoryThreshold: data?.cache_conversation_history_threshold ?? 0,
    };
    CONFIG_CACHE.set(orgId, { config, expiresAt: now + CONFIG_TTL_MS });
    return config;
  } catch {
    return { enabled: false, ttlSeconds: 3600, mode: "exact", similarityThreshold: 0.92, conversationHistoryThreshold: 0 };
  }
}

/**
 * Build a deterministic cache key for a gateway request.
 * Returns null if the request is not cacheable (streaming, non-deterministic).
 *
 * `partition` is an optional isolation boundary within an org (e.g. a per-user,
 * per-session, or per-feature key supplied via `x-prism-cache-key`). It is folded
 * into the hash so two requests only ever share a cached response when they share
 * the same partition — preventing cross-tenant/feature cache bleed. Defaults to ""
 * (org-wide), which preserves the previous behaviour for callers that omit it.
 */
export function buildCacheKey(
  orgId:    string,
  model:    string,
  messages: unknown[],
  temperature?: number,
  stream?:  boolean,
  partition?: string,
): string | null {
  if (stream) return null;  // never cache streaming
  if ((temperature ?? 1) > 0.1) return null;  // non-deterministic

  const raw = JSON.stringify({ m: model, msgs: messages, p: partition ?? "" });
  const hash = createHash("sha256").update(orgId + raw).digest("hex").slice(0, 32);
  return `prompt_cache:${orgId}:${hash}`;
}

export async function getCached(key: string): Promise<CachedEntry | null> {
  try {
    const val = await redis.get<CachedEntry>(key);
    return val ?? null;
  } catch {
    return null;
  }
}

export async function setCached(
  key:       string,
  entry:     CachedEntry,
  ttlSeconds: number,
): Promise<void> {
  try {
    await redis.set(key, entry, { ex: ttlSeconds });
  } catch { /* Redis unavailable — skip caching silently */ }
}

/**
 * Delete every exact-match (Tier 1) cache entry for an org.
 * Scans `prompt_cache:${orgId}:*` in batches and deletes them. Returns the
 * number of keys removed. Never throws — invalidation is best-effort.
 *
 * (Tier 2 semantic entries are purged separately via semanticCacheInvalidate.)
 */
export async function invalidateOrgCache(orgId: string): Promise<number> {
  const pattern = `prompt_cache:${orgId}:*`;
  let cursor = "0";
  let deleted = 0;
  try {
    do {
      const [next, keys] = await redis.scan(cursor, { match: pattern, count: 200 });
      cursor = String(next);
      if (keys.length) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
  } catch { /* Redis unavailable — return what we managed to delete */ }
  return deleted;
}
