/**
 * GET /auth/callback
 *
 * Handles both auth code flows:
 *   1. PKCE flow  — `?code=`       (OAuth providers + email confirmation same browser)
 *   2. Token hash — `?token_hash=&type=`  (email confirmation cross-device)
 *
 * Running the exchange server-side is critical: @supabase/ssr stores the PKCE
 * code verifier in a cookie, so it arrives with the incoming GET request.
 * A client-side useEffect approach loses the verifier when the email is opened
 * in a different browser or after the cookie has been cleared.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient } from "@/lib/supabase/server";
import type { EmailOtpType, User } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code      = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type      = searchParams.get("type") as EmailOtpType | null;
  const next      = searchParams.get("next") ?? "/dashboard";

  // On Vercel, request.url has an internal http://localhost origin.
  // x-forwarded-host carries the real external hostname (e.g. myapp.vercel.app).
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "localhost:3000";
  const proto = process.env.NODE_ENV === "development" ? "http" : "https";
  const origin = `${proto}://${host}`;

  const supabase = createServerClient();
  let user: User | null = null;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      const msg = encodeURIComponent(error?.message ?? "unknown");
      return NextResponse.redirect(`${origin}/?auth_error=exchange_failed&msg=${msg}`);
    }
    user = data.user;
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error || !data.user) {
      const msg = encodeURIComponent(error?.message ?? "unknown");
      return NextResponse.redirect(`${origin}/?auth_error=exchange_failed&msg=${msg}`);
    }
    user = data.user;
  } else {
    return NextResponse.redirect(`${origin}/?auth_error=missing_code`);
  }

  // Ensure org + member + default project exist for new users.
  // Skip for invite flows — the /join page owns that.
  let isNewUser = false;
  if (user && !next.startsWith("/join")) {
    const result = await ensureUserOrg(user).catch(() => ({ isNew: false }));
    isNewUser = result.isNew;
  }

  // Brand-new users go to /onboarding to set their org name + plan before
  // landing in the dashboard. The original `next` param is forwarded so that
  // after onboarding completes, they end up at the originally-requested page.
  if (isNewUser) {
    const encodedNext = encodeURIComponent(next.startsWith("/") ? next : `/${next}`);
    return NextResponse.redirect(`${origin}/onboarding?next=${encodedNext}`);
  }

  const dest = next.startsWith("/") ? next : `/${next}`;
  return NextResponse.redirect(`${origin}${dest}`);
}

async function ensureUserOrg(user: User): Promise<{ isNew: boolean }> {
  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("members")
    .select("org_id")
    .eq("user_id", user.id)
    .maybeSingle();

  // Returning user — org already exists
  if (existing) return { isNew: false };

  const emailBase = (user.email ?? "workspace").split("@")[0] ?? "workspace";
  const slug = `${emailBase.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${user.id.slice(0, 6)}`;

  let orgId: string | null = null;

  // plan defaults to 'free' (organizations.plan CHECK = free|pro|team|enterprise).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted } = await (admin as any)
    .from("organizations")
    .insert({ name: emailBase, slug, plan: "free", onboarding_step: 0 })
    .select("id")
    .single();

  if (inserted) {
    orgId = inserted.id;
  } else {
    const { data: found } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    orgId = found?.id ?? null;
  }

  if (!orgId) return { isNew: false };

  // Org-scoped owner membership (scope_type defaults to 'organization', role NOT NULL).
  await admin
    .from("members")
    .upsert(
      { org_id: orgId, user_id: user.id, scope_type: "organization", role: "owner" },
      { onConflict: "org_id,user_id", ignoreDuplicates: true },
    );

  // slug is required (non-nullable) — derive from orgId for guaranteed uniqueness.
  // (projects no longer has owner_id; project access derives from RBAC.)
  const projectSlug = `default-${orgId.slice(0, 8)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from("projects")
    .insert({ org_id: orgId, name: "Default", slug: projectSlug });

  return { isNew: true };
}
