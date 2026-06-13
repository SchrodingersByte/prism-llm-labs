import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const EVENTS_PER_PACK = 1_000_000;

const BodySchema = z.object({
  packs: z.number().int().min(1).max(100),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid packs value" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch current credit balance — credit_events requires 20260620 migration
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org, error: fetchErr } = await (admin as any)
    .from("organizations")
    .select("plan, subscription_status, credit_events")
    .eq("id", ctx.orgId)
    .single() as { data: { plan: string; subscription_status: string; credit_events: number | null } | null; error: unknown };

  if (fetchErr || !org) {
    // credit_events column might not exist yet — confirm free plan block still works
    return NextResponse.json({ error: "Credits require the 20260620 migration to be run" }, { status: 503 });
  }

  if (!org) {
    return NextResponse.json({ error: "Credits require a paid plan" }, { status: 403 });
  }

  const addedEvents  = parsed.data.packs * EVENTS_PER_PACK;
  const newBalance   = (org.credit_events ?? 0) + addedEvents;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from("organizations")
    .update({ credit_events: newBalance })
    .eq("id", ctx.orgId);

  if (error) {
    const isColumnMissing = error.code === "42703" ||
      (error.message ?? "").toLowerCase().includes("column");

    if (isColumnMissing) {
      return NextResponse.json(
        { error: "Event credits require the 20260620 migration to be run on Supabase" },
        { status: 503 },
      );
    }
    console.error("[billing/credits]", error);
    return NextResponse.json({ error: "Failed to add credits" }, { status: 500 });
  }

  return NextResponse.json({
    ok:             true,
    packs_added:    parsed.data.packs,
    events_added:   addedEvents,
    credit_balance: newBalance,
    cost_usd:       parsed.data.packs * 5,
  });
}
