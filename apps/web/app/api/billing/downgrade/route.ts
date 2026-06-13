import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Downgrade to the Free tier. Owner-only. Any Stripe subscription is canceled
 * separately via /api/billing/stripe/cancel; this flips the entitlement plan.
 */
export async function POST() {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("organizations")
    .update({ plan: "free", subscription_status: "active", trial_ends_at: null })
    .eq("id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: "Failed to downgrade", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, plan: "free" });
}
