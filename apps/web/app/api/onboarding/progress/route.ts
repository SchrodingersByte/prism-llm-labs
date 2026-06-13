/**
 * POST /api/onboarding/progress
 * Persists onboarding wizard step to organizations.onboarding_step.
 * Called fire-and-forget from the wizard — failures are silent.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";

const BodySchema = z.object({
  step: z.number().int().min(0).max(7),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Only advance — never go backwards (handles stale/concurrent calls)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("organizations")
    .update({ onboarding_step: parsed.data.step })
    .eq("id", ctx.orgId)
    .lt("onboarding_step", parsed.data.step);  // only update if new step > current

  return NextResponse.json({ ok: true });
}
