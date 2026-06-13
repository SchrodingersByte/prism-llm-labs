import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { cancelSubscription } from "@/lib/billing/stripe";

export async function POST(_req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe billing is not configured on this instance" }, { status: 503 });
  }

  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: member } = await supabase
    .from("members")
    .select("org_id, organizations(stripe_subscription_id)")
    .eq("user_id", user.id)
    .maybeSingle() as { data: { org_id: string; organizations: { stripe_subscription_id: string | null } | null } | null };

  const subId = member?.organizations?.stripe_subscription_id;
  if (!subId) return NextResponse.json({ error: "No active Stripe subscription" }, { status: 400 });

  await cancelSubscription(subId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from("organizations")
    .update({ subscription_status: "cancelled" })
    .eq("id", member!.org_id);

  return NextResponse.json({ success: true });
}
