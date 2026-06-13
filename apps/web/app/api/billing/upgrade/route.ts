import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const BodySchema = z.object({
  plan: z.enum(["pro", "team", "enterprise"]),
});

/**
 * Manual / no-payment plan flip — used in dev and for sales-led Enterprise.
 * Card-based self-serve goes through /api/billing/stripe/checkout and is
 * confirmed by the Stripe webhook (which is what sets subscription_status in
 * production). Owner-only: billing is not delegable to admins.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("organizations")
    .update({ plan: parsed.data.plan, subscription_status: "active", trial_ends_at: null })
    .eq("id", ctx.orgId);

  if (error) {
    return NextResponse.json({ error: "Failed to upgrade", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, plan: parsed.data.plan });
}
