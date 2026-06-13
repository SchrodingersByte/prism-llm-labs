/**
 * GET /api/metrics/circuit-breakers
 *
 * Returns all currently-tripped circuit breakers for the authenticated org.
 * Used by AlertsSlidePanel + useAlertCount() in the sidebar dock.
 *
 * Circuit breaker state is stored in Redis:
 *   cb:open:{orgId}:{apiKeyId}  → value = errorType string, TTL = 300s
 *   cb:errs:{orgId}:{apiKeyId}  → value = consecutive error count, TTL = 60s
 *
 * Only keys with state = "open" or "half_open" are included in the response.
 */

import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { redis } from "@/lib/upstash/redis";
import { getCircuitBreakerState } from "@/lib/upstash/circuit-breaker";

const CB_OPEN_TTL_S = 300; // must match value in circuit-breaker.ts

function openKey(orgId: string, apiKeyId: string) {
  return `cb:open:${orgId}:${apiKeyId}`;
}

interface BreakerItem {
  key_id:     string;
  key_name:   string;
  provider:   string;
  reason:     string;
  tripped_at: string;
  state:      "open" | "half_open";
}

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No org" }, { status: 403 });
  }
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const orgId = member.org_id;

  // Fetch all active API keys for the org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: keys } = await (admin as any)
    .from("api_keys")
    .select("id, name, key_prefix")
    .eq("org_id", orgId)
    .eq("is_active", true)
    .order("name") as { data: { id: string; name: string; key_prefix: string }[] | null };

  if (!keys || keys.length === 0) {
    return NextResponse.json({ breakers: [] });
  }

  // Check circuit breaker state for each key in parallel
  const results = await Promise.allSettled(
    keys.map(async (key) => {
      const state = await getCircuitBreakerState(orgId, key.id);
      if (state === "closed") return null;

      // Get the reason (error type) stored as the key value
      const [reason, ttl] = await Promise.allSettled([
        redis.get<string>(openKey(orgId, key.id)),
        redis.ttl(openKey(orgId, key.id)),
      ]);

      const reasonStr = reason.status === "fulfilled"
        ? (reason.value ?? "provider_error")
        : "provider_error";
      const ttlVal = ttl.status === "fulfilled" ? (ttl.value ?? 0) : 0;

      // Calculate when the circuit tripped: now - (max_ttl - remaining_ttl)
      const secondsAgo    = Math.max(0, CB_OPEN_TTL_S - ttlVal);
      const trippedAt     = new Date(Date.now() - secondsAgo * 1000).toISOString();

      return {
        key_id:     key.id,
        key_name:   key.name,
        provider:   "gateway",
        reason:     String(reasonStr).replace(/_/g, " "),
        tripped_at: trippedAt,
        state,
      } satisfies BreakerItem;
    }),
  );

  const breakers: BreakerItem[] = results
    .filter((r): r is PromiseFulfilledResult<BreakerItem | null> => r.status === "fulfilled")
    .map(r => r.value)
    .filter((v): v is BreakerItem => v !== null);

  return NextResponse.json({ breakers });
}
