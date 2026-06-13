import { NextRequest, NextResponse } from "next/server";
import Razorpay from "razorpay";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const rzp = new Razorpay({
    key_id:     process.env.RAZORPAY_KEY_ID!,
    key_secret: process.env.RAZORPAY_KEY_SECRET!,
  });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations")
    .select("razorpay_subscription_id, subscription_status")
    .eq("id", ctx.orgId)
    .single() as { data: { razorpay_subscription_id: string | null; subscription_status: string } | null };

  if (!org?.razorpay_subscription_id) {
    return NextResponse.json({ error: "No active subscription" }, { status: 400 });
  }

  if (!["active", "trialing"].includes(org.subscription_status)) {
    return NextResponse.json({ error: "Subscription is not active" }, { status: 400 });
  }

  // cancel_at_cycle_end: true = stays active until period end, then cancels
  await rzp.subscriptions.cancel(org.razorpay_subscription_id, true);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("organizations")
    .update({ subscription_status: "cancelled" })
    .eq("id", ctx.orgId);

  return NextResponse.json({ success: true });
}
