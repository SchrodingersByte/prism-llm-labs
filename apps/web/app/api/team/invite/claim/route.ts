import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { createHash } from "crypto";
import { z } from "zod";

const BodySchema = z.object({ token: z.string().min(1) });

interface InviteRow {
  id:         string;
  org_id:     string;
  email:      string;
  role:       string | null;        // org-wide role (null for project-scoped invites)
  scope_type: "organization" | "project";
  expires_at: string;
}

export async function POST(req: NextRequest) {
  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: invite } = await (adminClient as any)
    .from("pending_invites")
    .select("id, org_id, email, role, scope_type, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle() as { data: InviteRow | null };

  if (!invite) return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });

  if (new Date(invite.expires_at) < new Date()) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from("pending_invites").delete().eq("id", invite.id);
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  // Existing org membership?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (adminClient as any)
    .from("members").select("id, scope_type").eq("org_id", invite.org_id).eq("user_id", user.id)
    .maybeSingle() as { data: { id: string; scope_type: string } | null };

  const isProjectInvite = invite.scope_type === "project";
  let memberId = existing?.id ?? null;

  if (!existing) {
    // Create the membership: org-scoped carries the role; project-scoped has role
    // NULL with per-project grants in member_project_roles (CHECK enforces this).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: newMember, error: insertErr } = await (adminClient as any)
      .from("members")
      .insert({
        org_id:     invite.org_id,
        user_id:    user.id,
        scope_type: isProjectInvite ? "project" : "organization",
        role:       isProjectInvite ? null : invite.role,
      })
      .select("id")
      .single() as { data: { id: string } | null; error: unknown };
    if (insertErr || !newMember) return NextResponse.json({ error: "Failed to join org" }, { status: 500 });
    memberId = newMember.id;
  }

  // Apply per-project grants for a project-scoped invite. Skip when the caller is
  // already an ORG-scoped member (their org role already spans every project).
  if (isProjectInvite && memberId && (!existing || existing.scope_type === "project")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: grants } = await (adminClient as any)
      .from("pending_invite_projects").select("project_id, role").eq("invite_id", invite.id) as {
        data: Array<{ project_id: string; role: string }> | null;
      };
    for (const g of grants ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any).from("member_project_roles").upsert(
        { member_id: memberId, project_id: g.project_id, role: g.role },
        { onConflict: "member_id,project_id", ignoreDuplicates: false },
      );
    }
  }

  // Consume invite (cascades pending_invite_projects)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from("pending_invites").delete().eq("id", invite.id);

  await writeAuditLog({
    orgId: invite.org_id, actorUserId: user.id,
    action: "member.joined", targetType: "member",
    metadata: { role: invite.role, scope_type: invite.scope_type },
  });

  return NextResponse.json({ success: true, org_id: invite.org_id });
}
