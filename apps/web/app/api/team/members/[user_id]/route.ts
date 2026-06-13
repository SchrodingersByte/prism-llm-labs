import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";

// Org-wide role assignment. owner is creator-only (change it via ownership
// transfer, not here). owner/administrator may both manage these — matches the
// members RLS, which lets any org admin write non-owner member rows.
const RoleSchema = z.object({ role: z.enum(["administrator", "developer", "read_only"]) });

/** PATCH — set a member's ORG-WIDE role (promotes them to org scope). Owner/administrator. */
export async function PATCH(req: NextRequest, { params }: { params: { user_id: string } }) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const parsed = RoleSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: target } = await admin.from("members").select("id, role").eq("org_id", ctx.orgId).eq("user_id", params.user_id).maybeSingle() as { data: { id: string; role: string | null } | null };
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "Transfer ownership to change the owner's role" }, { status: 400 });

  // Assigning an org-wide role makes the member org-scoped; clear any per-project
  // grants (now redundant — the org role spans every project).
  await admin.from("members")
    .update({ scope_type: "organization", role: parsed.data.role })
    .eq("org_id", ctx.orgId).eq("user_id", params.user_id);
  await admin.from("member_project_roles").delete().eq("member_id", target.id);

  await writeAuditLog({ orgId: ctx.orgId, actorUserId: ctx.user.id, action: "member.role_changed", targetType: "member", targetId: params.user_id, metadata: { role: parsed.data.role } });
  return NextResponse.json({ success: true });
}

/** DELETE — remove a member from the org. Owner/administrator. (member_project_roles
 *  rows cascade-delete via their FK on members.id.) */
export async function DELETE(_req: NextRequest, { params }: { params: { user_id: string } }) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;
  if (params.user_id === ctx.user.id) return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any;
  const { data: target } = await admin.from("members").select("role").eq("org_id", ctx.orgId).eq("user_id", params.user_id).maybeSingle() as { data: { role: string | null } | null };
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.role === "owner") return NextResponse.json({ error: "Cannot remove the owner" }, { status: 400 });

  await admin.from("members").delete().eq("org_id", ctx.orgId).eq("user_id", params.user_id);
  await writeAuditLog({ orgId: ctx.orgId, actorUserId: ctx.user.id, action: "member.removed", targetType: "member", targetId: params.user_id });
  return NextResponse.json({ success: true });
}
