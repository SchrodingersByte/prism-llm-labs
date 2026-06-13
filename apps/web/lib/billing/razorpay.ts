import Razorpay from "razorpay";
import crypto from "crypto";

// Lazy singleton — constructed on first request, not at build time (mirrors stripe.ts).
let _rzp: Razorpay | null = null;

function getRzp(): Razorpay {
  if (!_rzp) {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay is not configured");
    }
    _rzp = new Razorpay({
      key_id:     process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }
  return _rzp;
}

export function razorpayConfigured(): boolean {
  return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function planIds(): Record<string, string> {
  return {
    pro:  process.env.RAZORPAY_PLAN_PRO  ?? "",
    team: process.env.RAZORPAY_PLAN_TEAM ?? "",
  };
}

/**
 * Create a Razorpay subscription for the org's chosen plan. Returns the
 * subscription id + the publishable key the frontend Checkout needs, plus the
 * hosted short_url fallback. org_id/plan ride along in `notes` so the webhook
 * can attribute events back to the org.
 */
export async function createRazorpaySubscription(params: {
  orgId:   string;
  orgName: string;
  plan:    string;
}): Promise<{ subscriptionId: string; shortUrl: string | null; keyId: string }> {
  const planId = planIds()[params.plan];
  if (!planId) throw new Error(`No Razorpay plan configured for "${params.plan}"`);

  const sub = await getRzp().subscriptions.create({
    plan_id:         planId,
    total_count:     120,   // up to 120 monthly cycles
    customer_notify: 1,
    notes:           { org_id: params.orgId, org_name: params.orgName, plan: params.plan },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return {
    subscriptionId: sub.id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    shortUrl:       (sub as any).short_url ?? null,
    keyId:          process.env.RAZORPAY_KEY_ID!,
  };
}

/** Verify the Checkout callback signature: HMAC_SHA256(payment_id|subscription_id). */
export function verifySubscriptionPayment(p: {
  razorpayPaymentId:      string;
  razorpaySubscriptionId: string;
  razorpaySignature:      string;
}): boolean {
  try {
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(`${p.razorpayPaymentId}|${p.razorpaySubscriptionId}`)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(p.razorpaySignature, "hex"),
    );
  } catch {
    return false;
  }
}

/** Verify a Razorpay webhook payload against RAZORPAY_WEBHOOK_SECRET. */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  try {
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest("hex");
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  } catch {
    return false;
  }
}

export async function cancelRazorpaySubscription(subscriptionId: string): Promise<void> {
  // cancel_at_cycle_end = true → access continues until the current cycle ends.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (getRzp().subscriptions as any).cancel(subscriptionId, true);
}
