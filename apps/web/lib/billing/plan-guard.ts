/**
 * Plan enforcement helpers for API routes.
 *
 * Usage:
 *   const guard = await requirePlan(orgId, "startup");
 *   if (guard) return guard;  // returns NextResponse 403 if plan insufficient
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export type PlanTier = "developer" | "startup" | "enterprise";

const TIER_RANK: Record<string, number> = {
  // Developer tier (entry paid plan)
  developer:  1,
  solo:       1, // legacy alias
  starter:    1, // legacy alias
  builder:    1, // legacy alias
  // Startup tier
  startup:    2,
  growth:     2, // legacy alias
  team:       2, // legacy alias
  // Enterprise tier
  enterprise: 3,
  scale:      3, // legacy alias
};

function planRank(plan: string | null): number {
  return TIER_RANK[(plan ?? "developer").toLowerCase()] ?? 1;
}

/**
 * Fetch the org's plan and return a 403 response if it's below the required tier.
 * Returns null when the org meets the requirement (proceed normally).
 */
export async function requirePlan(
  orgId:    string,
  required: PlanTier,
): Promise<NextResponse | null> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("organizations")
    .select("plan")
    .eq("id", orgId)
    .maybeSingle() as { data: { plan: string | null } | null };

  const current  = planRank(data?.plan ?? null);
  const minRank  = TIER_RANK[required];

  if (current < minRank) {
    const labels: Record<PlanTier, string> = {
      developer:  "Developer",
      startup:    "Startup",
      enterprise: "Enterprise",
    };
    return NextResponse.json(
      { error: `${labels[required]} plan required`, required, current: data?.plan ?? "developer" },
      { status: 403 },
    );
  }

  return null;
}
