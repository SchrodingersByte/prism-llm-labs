import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient } from "@/lib/supabase/server";
import { createCheckoutSession } from "@/lib/billing/stripe";

const BodySchema = z.object({
  plan: z.enum(["pro", "team"]),
});

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: "Stripe billing is not configured on this instance" }, { status: 503 });
  }

  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const { data: member } = await supabase
    .from("members")
    .select("org_id, organizations(name)")
    .eq("user_id", user.id)
    .maybeSingle() as { data: { org_id: string; organizations: { name: string } | null } | null };

  if (!member) {
    return NextResponse.json({ error: "No org found" }, { status: 403 });
  }

  if (!user.email) {
    return NextResponse.json(
      { error: "Account has no email address — required for billing" },
      { status: 400 },
    );
  }

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";
  const checkoutUrl = await createCheckoutSession({
    orgId:      member.org_id,
    orgName:    member.organizations?.name ?? "",
    plan:       body.data.plan,
    email:      user.email,
    successUrl: `${appUrl}/dashboard/settings/billing`,
    cancelUrl:  `${appUrl}/dashboard/settings/billing`,
  });

  return NextResponse.json({ url: checkoutUrl });
}
