import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { verifySubscriptionPayment } from "@/lib/billing/razorpay";
import { z } from "zod";

const BodySchema = z.object({
  razorpay_payment_id:      z.string().min(1),
  razorpay_subscription_id: z.string().min(1),
  razorpay_signature:       z.string().min(1),
  plan:                     z.enum(["pro", "team"]),
});

/**
 * Confirms a Razorpay Checkout callback. Verifies the HMAC signature, then
 * activates the plan. The webhook is the authoritative path for lifecycle
 * changes; this gives the user immediate confirmation. Owner-only.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const ok = verifySubscriptionPayment({
    razorpayPaymentId:      parsed.data.razorpay_payment_id,
    razorpaySubscriptionId: parsed.data.razorpay_subscription_id,
    razorpaySignature:      parsed.data.razorpay_signature,
  });
  if (!ok) return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from("organizations").update({
    plan:                     parsed.data.plan,
    subscription_status:      "active",
    razorpay_subscription_id: parsed.data.razorpay_subscription_id,
    trial_ends_at:            null,
  }).eq("id", ctx.orgId);

  if (error) return NextResponse.json({ error: "Failed to activate", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, plan: parsed.data.plan });
}
