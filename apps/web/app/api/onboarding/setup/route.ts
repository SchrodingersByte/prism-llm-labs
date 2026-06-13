/**
 * POST /api/onboarding/setup
 *
 * Called once by new users from the /onboarding page.
 * - Renames the skeleton org (created by ensureUserOrg in auth/callback)
 * - Sets the chosen plan
 * - Marks onboarding_step = 1 so the user is never redirected here again
 * - Persists full_name + marketing_consent in Supabase auth user_metadata
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { z } from "zod";

const TOS_VERSION = "2024-01"; // bump this string whenever your ToS changes

const Schema = z.object({
  org_name:          z.string().min(1, "Organisation name is required").max(100),
  full_name:         z.string().max(120).optional(),
  plan:              z.enum(["developer", "startup"]),
  marketing_consent: z.boolean(),
  tos_accepted:      z.literal(true, {
    errorMap: () => ({ message: "You must accept the Terms of Service to continue" }),
  }),
});

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { org_name, full_name, plan, marketing_consent, tos_accepted } = parsed.data;

  const member = await getMemberOrg(user.id);
  if (!member) {
    return NextResponse.json({ error: "No organisation found for user" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Build a URL-safe slug from the org name + a short org-id suffix for uniqueness
  const slugBase = org_name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const slug = `${slugBase}-${member.org_id.slice(0, 6)}`;

  // Update org: name, slug, plan, and mark onboarding complete
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: orgErr } = await (admin as any)
    .from("organizations")
    .update({
      name: org_name,
      slug,
      plan,
      onboarding_step: 1,
    })
    .eq("id", member.org_id);

  if (orgErr) {
    console.error("[onboarding/setup] org update failed:", orgErr);
    return NextResponse.json({ error: "Failed to update organisation" }, { status: 500 });
  }

  const now = new Date().toISOString();

  // Upsert consent row — single source of truth for legal + marketing records
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("user_consents")
    .upsert(
      {
        user_id:             user.id,
        tos_accepted,
        tos_accepted_at:     tos_accepted ? now : null,
        tos_version:         TOS_VERSION,
        marketing_consent,
        marketing_updated_at: now,
      },
      { onConflict: "user_id" },
    );

  // Also mirror into auth user_metadata so it's accessible in the JWT
  // and doesn't require a separate DB call for lightweight reads.
  await admin.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...user.user_metadata,
      ...(full_name ? { full_name, name: full_name } : {}),
      marketing_consent,
      tos_accepted,
      tos_accepted_at: now,
    },
  });

  return NextResponse.json({ ok: true });
}
