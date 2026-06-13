import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { providerForRegion } from "@/lib/billing/provider";
import { z } from "zod";

const BodySchema = z.object({ region: z.enum(["US", "IN"]) });

/**
 * Set the org's billing region (US → Stripe, IN → Razorpay). Owner-only.
 * Changing region only affects future checkouts; an active subscription should
 * be canceled first via the current provider.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid region" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("organizations").update({ billing_region: parsed.data.region }).eq("id", ctx.orgId);

  if (error) return NextResponse.json({ error: "Failed to set region", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, region: parsed.data.region, provider: providerForRegion(parsed.data.region) });
}
