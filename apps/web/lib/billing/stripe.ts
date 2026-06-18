import Stripe from "stripe";

// Lazy singleton — constructed on first request, not at build time.
// Stripe's constructor throws when the key is undefined, which would
// break `next build` in environments without STRIPE_SECRET_KEY set.
let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

function getPriceIds(): Record<string, string> {
  return {
    pro:  process.env.STRIPE_PRICE_PRO  ?? "",
    team: process.env.STRIPE_PRICE_TEAM ?? "",
  };
}

export async function createCheckoutSession(params: {
  orgId:      string;
  orgName:    string;
  plan:       string;
  email:      string;
  successUrl: string;
  cancelUrl:  string;
}): Promise<string> {
  const { orgId, orgName, plan, email, successUrl, cancelUrl } = params;

  const session = await getStripe().checkout.sessions.create({
    mode:               "subscription",
    customer_email:     email,
    line_items:         [{ price: getPriceIds()[plan], quantity: 1 }],
    subscription_data:  {
      trial_period_days: 14,
      metadata:          { org_id: orgId, org_name: orgName, plan },
    },
    success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  cancelUrl,
    metadata:    { org_id: orgId, plan },
  });

  return session.url!;
}

/**
 * Checkout session for an organization that does NOT exist yet — the org intent
 * rides in metadata so the webhook can create it on payment success. No trial:
 * the card is charged before the org is provisioned.
 */
export async function createCheckoutSessionForNewOrg(params: {
  metadata:   Record<string, string>;
  plan:       string;
  email:      string;
  successUrl: string;
  cancelUrl:  string;
}): Promise<string> {
  const { metadata, plan, email, successUrl, cancelUrl } = params;
  const session = await getStripe().checkout.sessions.create({
    mode:              "subscription",
    customer_email:    email,
    line_items:        [{ price: getPriceIds()[plan], quantity: 1 }],
    subscription_data: { metadata },
    success_url:       `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:        cancelUrl,
    metadata,
  });
  return session.url!;
}

export async function cancelSubscription(stripeSubscriptionId: string): Promise<void> {
  // Cancel at period end so access continues until billing cycle ends
  await getStripe().subscriptions.update(stripeSubscriptionId, {
    cancel_at_period_end: true,
  });
}

export async function handleStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<Stripe.Event> {
  return getStripe().webhooks.constructEvent(
    rawBody,
    signature,
    process.env.STRIPE_WEBHOOK_SECRET!,
  );
}
