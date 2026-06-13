import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";

const Schema = z.object({ new_owner_user_id: z.string().uuid() });

/**
 * POST /api/org/transfer-ownership — owner-only.
 * Transfers org ownership to another existing member. The current owner is
 * demoted to admin in the same transaction (via the transfer_org_ownership RPC),
 * preserving the one-owner invariant.
 */
export async function POST(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner"] });
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid new_owner_user_id" }, { status: 400 });
  }
  if (parsed.data.new_owner_user_id === ctx.user.id) {
    return NextResponse.json({ error: "You are already the owner" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Target must be a member of this org (clamps to tenant + gives a clean 404).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: target } = await (admin as any)
    .from("members")
    .select("user_id")
    .eq("org_id", ctx.orgId)
    .eq("user_id", parsed.data.new_owner_user_id)
    .maybeSingle() as { data: { user_id: string } | null };

  if (!target) {
    return NextResponse.json({ error: "Target user is not a member of this organization" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).rpc("transfer_org_ownership", {
    p_org_id:        ctx.orgId,
    p_current_owner: ctx.user.id,
    p_new_owner:     parsed.data.new_owner_user_id,
  });

  if (error) {
    return NextResponse.json({ error: "Transfer failed", detail: error.message }, { status: 500 });
  }

  await writeAuditLog({
    orgId:       ctx.orgId,
    actorUserId: ctx.user.id,
    action:      "org.ownership_transferred",
    targetType:  "organization",
    targetId:    ctx.orgId,
    metadata:    { new_owner_user_id: parsed.data.new_owner_user_id, previous_owner_user_id: ctx.user.id },
  });

  return NextResponse.json({ success: true, new_owner_user_id: parsed.data.new_owner_user_id });
}
