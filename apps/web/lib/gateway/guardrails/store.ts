/**
 * Guardrails store — loads an org's active rules + profiles.
 *
 * Same caching + fail-open contract as policy-router.ts's loadOrgPolicies:
 *   1. 60s in-memory cache
 *   2. 30s Redis cache
 *   3. Supabase load (and re-populate both caches)
 * Never throws — returns an empty bundle on any error so guardrail I/O can
 * never block or fail the gateway hot path.
 */

import { redis } from "@/lib/upstash/redis";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConditionNode } from "@/lib/gateway/policy-router";
import type { GuardrailRule, GuardrailProfile } from "./types";

export interface GuardrailBundle {
  rules:    GuardrailRule[];
  profiles: GuardrailProfile[];
}

const MEM_CACHE   = new Map<string, { bundle: GuardrailBundle; expiresAt: number }>();
const MEM_TTL_MS  = 60_000;
const REDIS_TTL_S = 30;
const EMPTY: GuardrailBundle = { rules: [], profiles: [] };

const cacheKey = (orgId: string) => `guardrails:${orgId}`;

export async function loadOrgGuardrails(
  orgId:    string,
  supabase: SupabaseClient,
): Promise<GuardrailBundle> {
  const now = Date.now();

  // 1. In-memory hit
  const mem = MEM_CACHE.get(orgId);
  if (mem && mem.expiresAt > now) return mem.bundle;

  // 2. Redis hit
  try {
    const cached = await redis.get<GuardrailBundle>(cacheKey(orgId));
    if (cached) {
      MEM_CACHE.set(orgId, { bundle: cached, expiresAt: now + MEM_TTL_MS });
      return cached;
    }
  } catch { /* Redis unavailable — fall through */ }

  // 3. Supabase load
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = supabase as any;
    const [rulesRes, profilesRes] = await Promise.all([
      sb.from("guardrail_rules")
        .select("id, profile_id, name, priority, apply_to, action, condition, sampling_rate, is_active")
        .eq("org_id", orgId)
        .eq("is_active", true)
        .order("priority", { ascending: true }),
      sb.from("guardrail_profiles")
        .select("id, name, type, pii_types, custom_patterns, config")
        .eq("org_id", orgId)
        .order("created_at", { ascending: true }),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rules: GuardrailRule[] = (rulesRes?.data ?? []).map((r: any) => ({
      id:            r.id,
      priority:      r.priority ?? 100,
      is_active:     r.is_active ?? true,
      apply_to:      r.apply_to,
      action:        r.action,
      profile_id:    r.profile_id,
      condition:     (r.condition ?? null) as ConditionNode | null,
      sampling_rate: r.sampling_rate ?? 1,
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const profiles: GuardrailProfile[] = (profilesRes?.data ?? []).map((p: any) => ({
      id:              p.id,
      name:            p.name,
      type:            p.type,
      pii_types:       p.pii_types ?? undefined,
      custom_patterns: Array.isArray(p.custom_patterns) ? p.custom_patterns : undefined,
      config:          p.config ?? undefined,
    }));

    const bundle: GuardrailBundle = { rules, profiles };
    MEM_CACHE.set(orgId, { bundle, expiresAt: now + MEM_TTL_MS });
    redis.set(cacheKey(orgId), bundle, { ex: REDIS_TTL_S }).catch(() => { /* non-blocking */ });
    return bundle;
  } catch {
    return EMPTY;  // fail-open
  }
}

/** Invalidate the in-memory + Redis cache for an org (call on guardrail writes). */
export async function invalidateGuardrailsCache(orgId: string): Promise<void> {
  MEM_CACHE.delete(orgId);
  await redis.del(cacheKey(orgId)).catch(() => { /* non-blocking */ });
}
