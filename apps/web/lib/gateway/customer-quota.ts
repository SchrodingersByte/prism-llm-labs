/**
 * Customer quota profile loader for the LLM gateway.
 *
 * Loads quota settings for a customer_id from customer_quota_profiles in Supabase,
 * caching in Redis (60s TTL) so the hot gateway path doesn't hit Postgres per-request.
 * Always fails open â€” if Redis and Supabase are unavailable, returns null (no quota enforced).
 */

import { createClient } from "@supabase/supabase-js";
import { redis } from "@/lib/upstash/redis";

export interface CustomerQuotaProfile {
  id:                   string;
  org_id:               string;
  customer_id:          string;
  display_name:         string | null;
  monthly_spend_usd:    number | null;
  monthly_token_limit:  number | null;
  soft_cap_pct:         number;
  soft_cap_model:       string | null;
  is_active:            boolean;
}

const CACHE_TTL_SECONDS = 60;

function cacheKey(orgId: string, customerId: string): string {
  return `cqp:${orgId}:${customerId}`;
}

/**
 * Load a customer's quota profile. Returns null if not found, inactive, or on error.
 * Cached in Redis for CACHE_TTL_SECONDS to minimise Supabase load on the hot path.
 */
export async function getCustomerQuotaProfile(
  orgId:      string,
  customerId: string,
): Promise<CustomerQuotaProfile | null> {
  const key = cacheKey(orgId, customerId);

  // 1. Try Redis cache
  try {
    const cached = await redis.get<CustomerQuotaProfile>(key);
    if (cached) return cached.is_active ? cached : null;
  } catch { /* Redis unavailable â€” fall through to DB */ }

  // 2. Read from Supabase
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    ) as any;

    const { data } = await supabase
      .from("customer_quota_profiles" as any)
      .select("id, org_id, customer_id, display_name, monthly_spend_usd, monthly_token_limit, soft_cap_pct, soft_cap_model, is_active")
      .eq("org_id", orgId)
      .eq("customer_id", customerId)
      .maybeSingle();

    if (!data) return null;

    // Cache the result regardless of is_active so we don't hammer Supabase for inactive customers
    await redis.set(key, data, { ex: CACHE_TTL_SECONDS }).catch(() => {});

    return data.is_active ? data : null;
  } catch {
    return null; // fail open
  }
}

/** Invalidate cached quota profile after a dashboard update. */
export async function invalidateCustomerQuotaCache(
  orgId:      string,
  customerId: string,
): Promise<void> {
  await redis.del(cacheKey(orgId, customerId)).catch(() => {});
}
