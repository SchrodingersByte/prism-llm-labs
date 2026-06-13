import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { handleStripeWebhook } from "@/lib/billing/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  // Initialised inside handler so build-time evaluation never runs
  // without the env vars present.
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const PLAN_MAP: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
    [process.env.STRIPE_PRICE_GROWTH  ?? ""]: "growth",
    [process.env.STRIPE_PRICE_SCALE   ?? ""]: "scale",
  };

  const rawBody  = await req.text();
  const signature = req.headers.get("stripe-signature") ?? "";

  let event;
  try {
    event = await handleStripeWebhook(rawBody, signature);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = event.data.object as any as Record<string, unknown>;

  switch (event.type) {
    case "checkout.session.completed": {
      const orgId = (obj.metadata as Record<string, string>)?.org_id;
      const plan  = (obj.metadata as Record<string, string>)?.plan ?? "starter";
      const subId = obj.subscription as string;
      if (orgId) {
        await supabase.from("organizations").update({
          stripe_subscription_id: subId,
          subscription_status:    "trialing",
          billing_provider:       "stripe",
          plan,
        }).eq("id", orgId);
      }
      break;
    }

    case "customer.subscription.updated": {
      // subscription object — obj.id IS the subscription ID
      const subId = obj.id as string;
      if (!subId) break;

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle() as { data: { id: string } | null };

      if (!org) break;

      let plan: string | undefined;
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data;
      if (items?.[0]?.price?.id) {
        plan = PLAN_MAP[items[0].price.id];
      }

      const periodEnd = obj.current_period_end
        ? new Date((obj.current_period_end as number) * 1000).toISOString()
        : null;

      await supabase.from("organizations").update({
        subscription_status: "active",
        billing_period_end:  periodEnd,
        ...(plan ? { plan } : {}),
      }).eq("id", org.id);
      break;
    }

    case "invoice.payment_succeeded": {
      // invoice object — obj.subscription is the linked subscription ID; obj.id is the invoice ID
      const subId = obj.subscription as string | null;
      if (!subId) break;

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle() as { data: { id: string } | null };

      if (!org) break;

      // Resolve plan from line items (subscription updated event)
      let plan: string | undefined;
      const items = (obj.items as { data?: Array<{ price?: { id?: string } }> })?.data;
      if (items?.[0]?.price?.id) {
        plan = PLAN_MAP[items[0].price.id];
      }

      const periodEnd = obj.current_period_end
        ? new Date((obj.current_period_end as number) * 1000).toISOString()
        : null;

      await supabase.from("organizations").update({
        subscription_status: "active",
        billing_period_end:  periodEnd,
        ...(plan ? { plan } : {}),
      }).eq("id", org.id);
      break;
    }

    case "invoice.payment_failed": {
      const subId = obj.subscription as string;
      if (!subId) break;

      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle() as { data: { id: string } | null };

      if (org) {
        await supabase.from("organizations")
          .update({ subscription_status: "halted" })
          .eq("id", org.id);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subId = obj.id as string;
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", subId)
        .maybeSingle() as { data: { id: string } | null };

      if (org) {
        await supabase.from("organizations")
          .update({ subscription_status: "cancelled" })
          .eq("id", org.id);
      }
      break;
    }

    default:
      // Unhandled event type — log and ignore
      break;
  }

  return NextResponse.json({ received: true });
}
