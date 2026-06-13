/**
 * Dynamic feature entitlement guard.
 *
 * Reads from the platform_features table (cached in Redis at
 * `platform_features:v1`, full-table, 60s TTL). Admins can change a
 * feature's min_plan or status via /admin/features without a deploy.
 *
 * Usage (API routes):
 *   const guard = await checkFeature(orgId, "pii_detection");
 *   if (guard) return guard;   // 403 if blocked
 *
 * Usage (Server Components):
 *   const meta = await getFeatureMeta(["pii_detection", "pii_block_mode"]);
 *   if (meta.pii_detection === "disabled") { ... }
 */
import { NextResponse } from "next/server";
import { createAdminClient, createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { redis } from "@/lib/upstash/redis";
import { planRank } from "@/lib/billing/plans";

export type FeatureStatus = "disabled" | "beta" | "live";

export interface FeatureConfig {
  key:           string;
  name:          string;
  description:   string | null;
  category:      string;
  status:        FeatureStatus;
  min_plan:      string;
  override_orgs: string[];
}

const CACHE_KEY = "platform_features:v1";
const CACHE_TTL = 60; // seconds

// In-memory fallback when Redis is unavailable
const MEM_CACHE: { rows: FeatureConfig[] | null; expiresAt: number } = {
  rows:      null,
  expiresAt: 0,
};

async function loadFeatures(): Promise<FeatureConfig[]> {
  // 1. Try Redis
  try {
    const cached = await redis.get<FeatureConfig[]>(CACHE_KEY);
    if (cached) {
      MEM_CACHE.rows      = cached;
      MEM_CACHE.expiresAt = Date.now() + CACHE_TTL * 1000;
      return cached;
    }
  } catch { /* Redis unavailable */ }

  // 2. Try in-memory fallback
  if (MEM_CACHE.rows && MEM_CACHE.expiresAt > Date.now()) {
    return MEM_CACHE.rows;
  }

  // 3. Read from DB
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from("platform_features")
      .select("key,name,description,category,status,min_plan,override_orgs")
      .order("category")
      .order("name") as { data: FeatureConfig[] | null };

    const rows = data ?? [];
    MEM_CACHE.rows      = rows;
    MEM_CACHE.expiresAt = Date.now() + CACHE_TTL * 1000;
    await redis.set(CACHE_KEY, rows, { ex: CACHE_TTL }).catch(() => {});
    return rows;
  } catch {
    return MEM_CACHE.rows ?? [];
  }
}

export async function getFeatureConfig(key: string): Promise<FeatureConfig | null> {
  const rows = await loadFeatures();
  return rows.find(r => r.key === key) ?? null;
}

/** Returns badge status for multiple feature keys in one cache read. */
export async function getFeatureMeta(
  keys: string[],
): Promise<Record<string, FeatureStatus>> {
  const rows = await loadFeatures();
  const map: Record<string, FeatureStatus> = {};
  for (const key of keys) {
    const row = rows.find(r => r.key === key);
    map[key] = row?.status ?? "disabled";
  }
  return map;
}

/**
 * Check whether the org is allowed to use a feature.
 * Returns a NextResponse(403) if blocked, or null to proceed.
 *
 * Logic:
 *   - feature.status === "disabled"                          → always 403
 *   - org.id in feature.override_orgs                       → allow (beta access)
 *   - planRank(org.plan) >= planRank(feature.min_plan)      → allow
 *   - otherwise                                             → 403
 */
export async function checkFeature(
  orgId:       string,
  featureKey:  string,
): Promise<NextResponse | null> {
  const feature = await getFeatureConfig(featureKey);

  if (!feature || feature.status === "disabled") {
    return NextResponse.json(
      { error: "feature_unavailable", feature: featureKey },
      { status: 403 },
    );
  }

  // Override list bypasses plan requirement (beta access)
  if ((feature.override_orgs ?? []).includes(orgId)) return null;

  // Fetch org plan
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from("organizations")
      .select("plan")
      .eq("id", orgId)
      .maybeSingle() as { data: { plan: string | null } | null };

    const orgRank  = planRank(data?.plan ?? null);
    const minRank  = planRank(feature.min_plan);

    if (orgRank < minRank) {
      return NextResponse.json(
        {
          error:    "plan_required",
          feature:  featureKey,
          required: feature.min_plan,
          current:  data?.plan ?? "free",
        },
        { status: 403 },
      );
    }
  } catch {
    // DB unavailable — fail open (don't break the app for infra issues)
    return null;
  }

  return null;
}

/**
 * Batch check: returns the subset of `keys` that `orgId` can access.
 * Used by the dashboard layout to compute which nav items are visible — one
 * cache read covers all keys rather than one per key.
 */
export async function getVisibleNavFeatures(
  orgId:   string,
  orgPlan: string,
  keys:    string[],
): Promise<string[]> {
  if (!keys.length) return [];
  const rows = await loadFeatures();
  const orgRank = planRank(orgPlan);

  return keys.filter(key => {
    const f = rows.find(r => r.key === key);
    if (!f || f.status === "disabled") return false;
    if ((f.override_orgs ?? []).includes(orgId)) return true;
    return orgRank >= planRank(f.min_plan);
  });
}

/**
 * Session-resolving variant for use in Server Components and layout files.
 * Resolves the current user's org from the session, then calls checkFeature().
 * Returns null (allow) if the user is unauthenticated or has no org — layouts
 * should redirect to /login separately for auth; this only gates the feature.
 *
 * Usage (layout.tsx):
 *   const blocked = await checkFeatureForUser("finops");
 *   if (blocked) redirect(`/dashboard?upgrade=finops`);
 */
export async function checkFeatureForUser(featureKey: string): Promise<NextResponse | null> {
  try {
    const supabase = createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null; // auth middleware handles unauthenticated separately
    const member = await getMemberOrg(user.id);
    if (!member) return null;
    return checkFeature(member.org_id, featureKey);
  } catch {
    return null; // fail open
  }
}

/**
 * Admin-only: update a feature's config and immediately flush the cache
 * so all instances pick up the change within seconds.
 */
export async function setFeatureConfig(
  key:       string,
  patch:     Partial<Pick<FeatureConfig, "status" | "min_plan" | "override_orgs">>,
  updatedBy: string,
): Promise<void> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("platform_features")
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq("key", key);

  // Flush both caches
  await redis.del(CACHE_KEY).catch(() => {});
  MEM_CACHE.rows      = null;
  MEM_CACHE.expiresAt = 0;
}
