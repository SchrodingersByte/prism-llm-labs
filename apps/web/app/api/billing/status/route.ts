import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getPlan } from "@/lib/billing/plans";
import { getUsageSummary } from "@/lib/billing/usage";
import { providerForRegion } from "@/lib/billing/provider";

/**
 * Billing status for the active org: plan entitlements, subscription state,
 * member usage vs cap, and metered event usage vs quota. Read-only; visible to
 * any member (the billing *actions* are owner-only). memberLimit/eventsIncluded
 * serialize to null when unlimited (Infinity → null in JSON).
 */
export async function GET() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  const [{ data: org }, { count: memberCount }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("organizations")
      .select("plan, subscription_status, trial_ends_at, billing_region").eq("id", ctx.orgId).maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("members")
      .select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId),
  ]) as [{ data: { plan: string; subscription_status: string; trial_ends_at: string | null; billing_region: string } | null }, { count: number | null }];

  const plan  = getPlan(org?.plan);
  const usage = await getUsageSummary(ctx.orgId, org?.plan);

  return NextResponse.json({
    plan: {
      id:            plan.id,
      name:          plan.name,
      priceUsd:      plan.priceUsd,
      memberLimit:   Number.isFinite(plan.memberLimit) ? plan.memberLimit : null,
      eventsIncluded: Number.isFinite(plan.eventsIncluded) ? plan.eventsIncluded : null,
      retentionDays: plan.retentionDays,
    },
    subscription_status: org?.subscription_status ?? "active",
    trial_ends_at:       org?.trial_ends_at ?? null,
    billing:             { region: org?.billing_region ?? "US", provider: providerForRegion(org?.billing_region) },
    members:             { used: memberCount ?? 0, limit: Number.isFinite(plan.memberLimit) ? plan.memberLimit : null },
    usage,
  });
}
