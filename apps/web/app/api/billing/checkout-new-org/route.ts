import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { providerForRegion } from "@/lib/billing/provider";
import { createCheckoutSessionForNewOrg } from "@/lib/billing/stripe";
import { createSubscriptionForNewOrg, razorpayConfigured } from "@/lib/billing/razorpay";
import { newOrgMetadata, type NewOrgIntent } from "@/lib/billing/new-org";
import { z } from "zod";

const BodySchema = z.object({
  org_name: z.string().min(1).max(100),
  plan:     z.enum(["pro", "team"]),
  type:     z.enum(["personal", "team", "business", "education"]).optional(),
  region:   z.enum(["US", "IN"]).optional(),
});

/**
 * Start checkout for an organization that does NOT exist yet. The org is created
 * by the provider webhook (and the synchronous Razorpay verify) once payment
 * succeeds — so paid tiers are billed BEFORE the org is provisioned. Any
 * authenticated user may create a new paid org (they become its owner).
 */
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.email) return NextResponse.json({ error: "Account has no email — required for billing" }, { status: 400 });

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const intent: NewOrgIntent = {
    org_name: parsed.data.org_name.trim(),
    user_id:  user.id,
    plan:     parsed.data.plan,
    type:     parsed.data.type,
    region:   parsed.data.region ?? "US",
  };
  const meta = newOrgMetadata(intent);
  const provider = providerForRegion(intent.region);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";

  if (provider === "stripe") {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Stripe billing is not configured on this instance" }, { status: 503 });
    }
    const url = await createCheckoutSessionForNewOrg({
      metadata:   meta,
      plan:       intent.plan,
      email:      user.email,
      successUrl: `${appUrl}/dashboard`,
      cancelUrl:  `${appUrl}/dashboard`,
    });
    return NextResponse.json({ provider: "stripe", url });
  }

  // Razorpay (India)
  if (!razorpayConfigured()) {
    return NextResponse.json({ error: "Razorpay billing is not configured on this instance" }, { status: 503 });
  }
  const sub = await createSubscriptionForNewOrg({ plan: intent.plan, notes: meta });
  return NextResponse.json({
    provider:       "razorpay",
    subscriptionId: sub.subscriptionId,
    keyId:          sub.keyId,
    shortUrl:       sub.shortUrl,
  });
}
