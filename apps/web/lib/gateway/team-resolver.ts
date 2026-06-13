/**
 * Team attribution resolver for the LLM gateway.
 *
 * `team_id` is stamped on every llm_event so `spend_by_team` can attribute
 * cost to org teams. Two resolution paths, evaluated in order:
 *
 *   1. Explicit override — caller sends `x-prism-team-id` (becomes
 *      tags['team_id'] via extractRuntimeTags). Mirrors the industry-standard
 *      "X-Team-ID" header allocation pattern — the caller knows best which
 *      team a given workload belongs to (e.g. a CI job stamping its squad).
 *   2. Membership fallback — resolve the authenticated user's first team
 *      via `team_members`, scoped to the org. Covers orgs that manage teams
 *      through the dashboard rather than tagging every call.
 *
 * Cached in-memory for CACHE_TTL_MS (mirrors getOrgCacheConfig in cache.ts)
 * so the hot gateway path doesn't hit Postgres per-request. Always fails
 * open — returns "" (untagged) on any error; never blocks the caller.
 */

import { createAdminClient } from "@/lib/supabase/server";

const TEAM_CACHE = new Map<string, { teamId: string; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function cacheKey(orgId: string, userId: string): string {
  return `${orgId}:${userId}`;
}

/**
 * Resolve the team_id to stamp on a gateway event.
 *
 * @param orgId        Organization that owns the request.
 * @param userId       Authenticated user attached to the Prism API key (may be "").
 * @param explicitTag  Value of tags['team_id'] if the caller set x-prism-team-id /
 *                     x-prism-tags — always wins when present.
 */
export async function resolveTeamId(
  orgId:        string,
  userId:       string,
  explicitTag?: string,
): Promise<string> {
  const explicit = explicitTag?.trim();
  if (explicit) return explicit;

  if (!userId) return "";

  const key = cacheKey(orgId, userId);
  const now = Date.now();
  const hit = TEAM_CACHE.get(key);
  if (hit && hit.expiresAt > now) return hit.teamId;

  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from("team_members")
      .select("team_id, teams!inner(org_id)")
      .eq("user_id", userId)
      .eq("teams.org_id", orgId)
      .limit(1)
      .maybeSingle() as { data: { team_id?: string } | null };

    const teamId = data?.team_id ?? "";
    TEAM_CACHE.set(key, { teamId, expiresAt: now + CACHE_TTL_MS });
    return teamId;
  } catch {
    return ""; // fail open — never block the gateway on attribution lookups
  }
}
