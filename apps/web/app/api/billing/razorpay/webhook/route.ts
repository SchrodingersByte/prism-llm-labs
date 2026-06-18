import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { verifyWebhookSignature } from "@/lib/billing/razorpay";
import { finalizeNewOrg, readNewOrgIntent } from "@/lib/billing/new-org";

/**
 * Razorpay webhook — authoritative source for subscription state in the IN
 * region. Verifies the signature, then maps subscription lifecycle events onto
 * organizations.plan / subscription_status. For new-org checkouts (notes.new_org)
 * it CREATES the org on payment success; existing orgs ride in notes.org_id.
 * Service-role; no session.
 */
export async function POST(req: NextRequest) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Razorpay webhook not configured" }, { status: 503 });
  }
  const sig = req.headers.get("x-razorpay-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const raw = await req.text();
  if (!verifyWebhookSignature(raw, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let event: any;
  try { event = JSON.parse(raw); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = event?.payload?.subscription?.entity;
  const intent = readNewOrgIntent(sub?.notes);
  const notesOrgId: string | undefined = sub?.notes?.org_id;
  if (!sub || (!notesOrgId && !intent)) return NextResponse.json({ received: true });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setOrg = (id: string, patch: Record<string, unknown>) => (admin as any).from("organizations").update(patch).eq("id", id);
  const resolveOrgId = async (): Promise<string | null> => {
    if (notesOrgId) return notesOrgId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any).from("organizations").select("id").eq("razorpay_subscription_id", sub.id).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  };

  try {
    switch (event.event) {
      case "subscription.activated":
      case "subscription.charged": {
        if (intent) {
          await finalizeNewOrg({ provider: "razorpay", subscriptionId: sub.id, intent });
          break;
        }
        const patch: Record<string, unknown> = {
          subscription_status:      "active",
          razorpay_subscription_id: sub.id,
          trial_ends_at:            null,
        };
        if (sub.notes?.plan) patch.plan = sub.notes.plan;
        if (notesOrgId) await setOrg(notesOrgId, patch);
        break;
      }
      case "subscription.halted":
      case "subscription.pending": {
        const id = await resolveOrgId();
        if (id) await setOrg(id, { subscription_status: "past_due" });
        break;
      }
      case "subscription.cancelled":
      case "subscription.completed": {
        const id = await resolveOrgId();
        if (id) await setOrg(id, { subscription_status: "canceled", plan: "free" });
        break;
      }
    }
  } catch (e) {
    console.error("[razorpay/webhook] handler error:", e);
    return NextResponse.json({ error: "Handler error" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
