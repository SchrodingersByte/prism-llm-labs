import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { handleStripeWebhook } from "@/lib/billing/stripe";
import { finalizeNewOrg, readNewOrgIntent } from "@/lib/billing/new-org";

/**
 * Stripe webhook — the source of truth for subscription state in production.
 * Verifies the signature, then flips organizations.plan / subscription_status.
 * For new-org checkouts (metadata.new_org) it CREATES the org on payment success.
 * Service-role (no session).
 */
function mapStripeStatus(s: string): "trialing" | "active" | "past_due" | "canceled" {
  if (s === "trialing") return "trialing";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "active";
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try {
    event = await handleStripeWebhook(raw, sig);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setOrg = (orgId: string, patch: Record<string, unknown>) =>
    (admin as any).from("organizations").update(patch).eq("id", orgId);
  const orgIdForSub = async (subId: string): Promise<string | null> => {
    if (!subId) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from("organizations").select("id").eq("stripe_subscription_id", subId).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object;
        // New-org checkout → create the org now that payment succeeded.
        const intent = readNewOrgIntent(s.metadata);
        if (intent && typeof s.subscription === "string") {
          await finalizeNewOrg({
            provider:       "stripe",
            subscriptionId: s.subscription,
            customerId:     typeof s.customer === "string" ? s.customer : null,
            intent,
          });
          break;
        }
        // Existing-org upgrade.
        const orgId = s.metadata?.org_id;
        if (orgId) {
          await setOrg(orgId, {
            plan:                   s.metadata?.plan ?? "pro",
            subscription_status:    "active",
            stripe_customer_id:     typeof s.customer === "string" ? s.customer : null,
            stripe_subscription_id: typeof s.subscription === "string" ? s.subscription : null,
            trial_ends_at:          null,
          });
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        const orgId = (sub.metadata?.org_id as string | undefined)
          ?? (await orgIdForSub(typeof sub.id === "string" ? sub.id : ""));
        if (orgId) {
          const patch: Record<string, unknown> = {
            subscription_status: event.type === "customer.subscription.deleted"
              ? "canceled"
              : mapStripeStatus(sub.status),
          };
          if (event.type === "customer.subscription.deleted") patch.plan = "free";
          await setOrg(orgId, patch);
        }
        break;
      }
    }
  } catch (e) {
    console.error("[stripe/webhook] handler error:", e);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
