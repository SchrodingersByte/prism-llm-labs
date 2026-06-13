/**
 * Plan tiers — single source of truth for entitlements, member caps, usage
 * quotas, and pricing. Mirrors the organizations.plan CHECK constraint and the
 * platform_features.min_plan values (migration 20260620000000).
 *
 * Billing model (decided 2026-06-12): metered on ingested telemetry events per
 * month, NOT per seat. Member count is a per-tier CAP, not a per-head charge.
 * Mirrors the design doc at docs/billing-rbac-phase-bcd.md.
 */

export type PlanId = "free" | "pro" | "team" | "enterprise";

export interface Plan {
  id:             PlanId;
  name:           string;
  rank:           number;         // entitlement ordering (feature gating)
  priceUsd:       number | null;  // monthly flat fee; null = custom (enterprise)
  memberLimit:    number;         // max org members (Infinity = unlimited)
  eventsIncluded: number;         // included telemetry events / month before overage
  overagePer1k:   number | null;  // USD per 1,000 events beyond quota; null = n/a
  retentionDays:  number;
  hardCapDefault: boolean;        // hard-stop ingestion at quota (free) vs billed overage
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", rank: 1, priceUsd: 0,
    memberLimit: 2, eventsIncluded: 100_000, overagePer1k: null,
    retentionDays: 7, hardCapDefault: true,
  },
  pro: {
    id: "pro", name: "Pro", rank: 2, priceUsd: 49,
    memberLimit: 10, eventsIncluded: 2_000_000, overagePer1k: 0.5,
    retentionDays: 90, hardCapDefault: false,
  },
  team: {
    id: "team", name: "Team", rank: 3, priceUsd: 199,
    memberLimit: 50, eventsIncluded: 10_000_000, overagePer1k: 0.3,
    retentionDays: 365, hardCapDefault: false,
  },
  enterprise: {
    id: "enterprise", name: "Enterprise", rank: 4, priceUsd: null,
    memberLimit: Number.POSITIVE_INFINITY, eventsIncluded: Number.POSITIVE_INFINITY,
    overagePer1k: null, retentionDays: 730, hardCapDefault: false,
  },
};

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

/** Self-serve upgrade targets (free = default, enterprise = sales-led but allowed). */
export const UPGRADABLE_PLANS: PlanId[] = ["pro", "team", "enterprise"];

export function getPlan(plan: string | null | undefined): Plan {
  return PLANS[(plan ?? "free") as PlanId] ?? PLANS.free;
}

/** Entitlement rank for feature gating. Unknown/legacy values fall back to free. */
export function planRank(plan: string | null | undefined): number {
  return getPlan(plan).rank;
}

/** Max members allowed on the plan (Infinity = unlimited). */
export function memberLimitFor(plan: string | null | undefined): number {
  return getPlan(plan).memberLimit;
}
