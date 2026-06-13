import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { providerForRegion } from "@/lib/billing/provider";
import { createCheckoutSession } from "@/lib/billing/stripe";
import { createRazorpaySubscription, razorpayConfigured } from "@/lib/billing/razorpay";
import { z } from "zod";

const BodySchema = z.object({ plan: z.enum(["pro", "team"]) });

/**
 * Unified checkout entry point. Reads the org's billing_region and dispatches to
 * the right provider: US → Stripe (hosted checkout URL), IN → Razorpay (returns
 * a subscription id + key for the client-side Razorpay Checkout). Owner-only.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations").select("name, billing_region").eq("id", ctx.orgId).maybeSingle() as {
      data: { name: string; billing_region: string } | null;
    };

  const provider = providerForRegion(org?.billing_region);

  if (provider === "stripe") {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe billing is not configured on this instance" }, { status: 503 });
    }
    if (!ctx.user.email) {
      return NextResponse.json({ error: "Account has no email — required for billing" }, { status: 400 });
    }
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";
    const url = await createCheckoutSession({
      orgId:      ctx.orgId,
      orgName:    org?.name ?? "",
      plan:       parsed.data.plan,
      email:      ctx.user.email,
      successUrl: `${appUrl}/dashboard/billing`,
      cancelUrl:  `${appUrl}/dashboard/billing`,
    });
    return NextResponse.json({ provider: "stripe", url });
  }

  // Razorpay (India)
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay billing is not configured on this instance" }, { status: 503 });
  }
  const sub = await createRazorpaySubscription({
    orgId:   ctx.orgId,
    orgName: org?.name ?? "",
    plan:    parsed.data.plan,
  });
  // Persist the pending subscription so the webhook/verify can reconcile.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("organizations").update({ razorpay_subscription_id: sub.subscriptionId }).eq("id", ctx.orgId);

  return NextResponse.json({
    provider:       "razorpay",
    subscriptionId: sub.subscriptionId,
    keyId:          sub.keyId,
    shortUrl:       sub.shortUrl,
  });
}
