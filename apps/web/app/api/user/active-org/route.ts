import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

const Schema = z.object({ org_id: z.string().uuid() });

export async function PATCH(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid org_id" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify the user is actually a member of the requested org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (admin as any)
    .from("members")
    .select("id")
    .eq("org_id", parsed.data.org_id)
    .eq("user_id", ctx.user.id)
    .maybeSingle() as { data: { id: string } | null };

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this org" }, { status: 403 });
  }

  // Upsert active org preference
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("user_preferences")
    .upsert(
      { user_id: ctx.user.id, active_org_id: parsed.data.org_id, updated_at: new Date().toISOString() },
      { onConflict: "user_id" },
    );

  return NextResponse.json({ org_id: parsed.data.org_id });
}
