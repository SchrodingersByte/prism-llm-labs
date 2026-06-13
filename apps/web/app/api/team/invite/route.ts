import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";
import { buildInviteEmailHtml } from "@/lib/emails/templates";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { memberLimitFor, getPlan } from "@/lib/billing/plans";
import { writeAuditLog } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications";
import { randomBytes, createHash } from "crypto";
import { z } from "zod";

// Invitable org roles (owner is creator-only and not invitable). When project_id
// is set, the invite is project-scoped: the role applies to that project.
const InviteSchema = z.object({
  email:      z.string().email(),
  role:       z.enum(["administrator", "developer", "read_only"]).default("developer"),
  project_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  // Guard: catch any unhandled exception so we always return JSON, never HTML
  try {
    return await handleInvite(req);
  } catch (e) {
    console.error("Unhandled invite error:", e);
    return NextResponse.json(
      { error: "Internal server error", detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

async function handleInvite(req: NextRequest) {
  // Fail fast with a clear message if required env vars are missing
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "Server misconfiguration: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set in environment variables." },
      { status: 500 },
    );
  }

  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const adminClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = InviteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: (parsed.error.issues[0] ? `${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}` : "Invalid request") }, { status: 400 });

  const { email, role, project_id } = parsed.data;

  // Owner is not invitable (enum excludes it). owner/administrator may both invite
  // administrators/developers/read_only — matches the members RLS, which lets any
  // org admin write non-owner member rows.

  const admin = createAdminClient();

  // Member cap enforcement: per-tier limit (NOT per-seat — see lib/billing/plans.ts).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [{ count: memberCount }, { data: orgRow }] = await Promise.all([
    (admin as any).from("members").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId),
    (admin as any).from("organizations").select("plan").eq("id", ctx.orgId).maybeSingle(),
  ]) as [{ count: number | null }, { data: { plan: string } | null }];

  const limit = memberLimitFor(orgRow?.plan);
  if ((memberCount ?? 0) >= limit) {
    return NextResponse.json(
      {
        error:   "member_limit_reached",
        message: `Your ${getPlan(orgRow?.plan).name} plan allows ${Number.isFinite(limit) ? limit : "unlimited"} members. Upgrade to invite more.`,
      },
      { status: 403 },
    );
  }

  // Validate project_id belongs to org
  if (project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: proj } = await (admin as any)
      .from("projects").select("id").eq("id", project_id).eq("org_id", ctx.orgId).maybeSingle();
    if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Check if this email belongs to an existing Prism user (active member check + notification target)
  let existingUserId: string | null = null;
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const resp = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?filter=${encodeURIComponent(email)}&per_page=20`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    if (resp.ok) {
      const { users } = await resp.json() as { users: Array<{ id: string; email: string }> };
      const match = users?.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (match) {
        existingUserId = match.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: existingMember } = await (adminClient as any)
          .from("members").select("id")
          .eq("org_id", ctx.orgId).eq("user_id", match.id).maybeSingle();
        if (existingMember) {
          return NextResponse.json({ error: "already_member" }, { status: 409 });
        }
      }
    }
  } catch { /* non-fatal — fall through to invite */ }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgRaw = await (adminClient as any)
    .from("organizations").select("name").eq("id", ctx.orgId).single();
  const { data: org } = orgRaw as { data: { name: string } | null };

  const rawToken  = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h

  const isProjectScoped = Boolean(project_id);

  // Idempotent: delete prior invite for same email+org (cascades pending_invite_projects)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from("pending_invites").delete()
    .eq("org_id", ctx.orgId).eq("email", email);

  // pending_invites: org-scoped carries the role; project-scoped has role NULL and
  // the per-project role lives in pending_invite_projects (CHECK enforces this).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inviteRow, error: insertErr } = await (adminClient as any)
    .from("pending_invites")
    .insert({
      org_id:     ctx.orgId,
      email,
      scope_type: isProjectScoped ? "project" : "organization",
      role:       isProjectScoped ? null : role,
      token_hash: tokenHash,
      expires_at: expiresAt,
      invited_by: ctx.user.id,
    })
    .select("id")
    .single() as { data: { id: string } | null; error: { message?: string } | null };

  if (insertErr || !inviteRow) {
    console.error("pending_invites insert error:", insertErr);
    return NextResponse.json(
      { error: "Failed to create invite", detail: insertErr?.message ?? String(insertErr) },
      { status: 500 },
    );
  }

  if (isProjectScoped && project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: pErr } = await (adminClient as any)
      .from("pending_invite_projects")
      .insert({ invite_id: inviteRow.id, project_id, role });
    if (pErr) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (adminClient as any).from("pending_invites").delete().eq("id", inviteRow.id);
      return NextResponse.json({ error: "Failed to create project invite", detail: pErr.message }, { status: 500 });
    }
  }

  // If the invited person already has a Prism account, send them an in-app notification
  if (existingUserId) {
    await createNotification({
      userId:    existingUserId,
      orgId:     ctx.orgId,
      type:      "invite_received",
      title:     `You've been invited to join ${org?.name ?? "a workspace"}`,
      body:      `${ctx.user.email ?? "Someone"} invited you as ${role}`,
      actionUrl: `/join?token=${rawToken}`,
      metadata:  { invited_by: ctx.user.id, role, project_id: project_id ?? null },
    });
  }

  await writeAuditLog({
    orgId: ctx.orgId, actorUserId: ctx.user.id,
    action: "member.invited", targetType: "member",
    metadata: { email, role, project_id: project_id ?? null },
  });

  const appUrl    = process.env.NEXT_PUBLIC_APP_URL || "https://useprism.dev";
  const inviteUrl = `${appUrl}/join?token=${rawToken}`;

  let emailWarning: string | undefined;
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error: emailErr } = await resend.emails.send({
        from:    process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
        to:      email,
        subject: `You've been invited to join ${org?.name ?? "a Prism workspace"}`,
        html:    buildInviteEmailHtml({
          inviterName: ctx.user.email ?? "A teammate",
          orgName:     org?.name ?? "the team",
          inviteUrl,
        }),
      });
      if (emailErr) {
        console.error("Resend error:", emailErr);
        // Resend sandbox: can only send to verified addresses — this is expected during dev
        emailWarning = `Invite created but email couldn't be delivered. Share the link below directly.`;
      }
    } catch (e) {
      console.error("Resend exception:", e);
      emailWarning = `Invite created but email couldn't be delivered. Share the link below directly.`;
    }
  } else {
    emailWarning = `Email not configured (RESEND_API_KEY missing). Share this link directly:`;
  }

  return NextResponse.json({ success: true, invite_url: inviteUrl, warning: emailWarning });
}
