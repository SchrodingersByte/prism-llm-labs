/**
 * Shared API key authentication for ingest endpoints.
 * Used by both /api/ingest (LLM events) and /api/mcp/ingest (MCP tool events).
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { ingestRatelimit } from "@/lib/upstash/ratelimit";
import { planToTtlDays } from "@/lib/pricing/table";

export interface AuthedKey {
  id:                  string;
  org_id:              string;
  project_id:          string | null;
  user_id:             string | null;
  assigned_user_id:    string | null;
  key_prefix:          string;
  cost_hard_cap_usd:   number | null;
  daily_cost_cap_usd:  number | null;
  usage_buffer_pct:    number | null;
  ttl_days:            number;
  plan:                string;
}

export type AuthResult =
  | { ok: true;  key: AuthedKey; keyHash: string }
  | { ok: false; status: number; error: string; code: string };

export async function authenticateIngestKey(
  authHeader: string,
  rateLimitKey?: string,
): Promise<AuthResult> {
  const apiKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!apiKey) {
    return { ok: false, status: 401, error: "Missing API key", code: "missing_key" };
  }

  const keyHash   = createHash("sha256").update(apiKey).digest("hex");
  const keyPrefix = apiKey.slice(0, 12);

  // Rate limit per key (500 events/min)
  const rlKey = rateLimitKey ?? keyHash;
  const { success } = await ingestRatelimit.limit(rlKey);
  if (!success) {
    return { ok: false, status: 429, error: "Rate limit exceeded", code: "rate_limited" };
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // NOTE: user_id / assigned_user_id / cost_hard_cap_usd / daily_cost_cap_usd /
  // usage_buffer_pct were dropped from api_keys (caps now live in key_caps). The
  // mapping below already reads each via an optional cast, so they resolve to null.
  const { data: keyRow } = await supabaseAdmin
    .from("api_keys")
    .select("id, org_id, project_id, is_active, expires_at, key_prefix, organizations(plan)")
    .eq("key_hash", keyHash)
    .eq("is_active", true)
    .maybeSingle();

  if (!keyRow) {
    return { ok: false, status: 401, error: "Invalid or inactive API key", code: "key_not_found" };
  }

  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return { ok: false, status: 401, error: "API key has expired", code: "key_expired" };
  }

  const orgPlan = (keyRow.organizations as { plan?: string } | null)?.plan ?? "starter";
  const ttlDays = planToTtlDays(orgPlan);

  return {
    ok: true,
    keyHash,
    key: {
      id:                (keyRow as { id: string }).id,
      org_id:            keyRow.org_id,
      project_id:        (keyRow as { project_id?: string | null }).project_id ?? null,
      user_id:           (keyRow as { user_id?: string | null }).user_id ?? null,
      assigned_user_id:  (keyRow as { assigned_user_id?: string | null }).assigned_user_id ?? null,
      key_prefix:        (keyRow as { key_prefix?: string }).key_prefix ?? keyPrefix,
      cost_hard_cap_usd: (keyRow as { cost_hard_cap_usd?: number | null }).cost_hard_cap_usd ?? null,
      daily_cost_cap_usd:(keyRow as { daily_cost_cap_usd?: number | null }).daily_cost_cap_usd ?? null,
      usage_buffer_pct:  (keyRow as { usage_buffer_pct?: number | null }).usage_buffer_pct ?? null,
      ttl_days:          ttlDays,
      plan:              orgPlan,
    },
  };
}
