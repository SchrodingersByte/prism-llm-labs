import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { exchangeCodeForProfile } from "@/lib/jackson/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/sso/callback?code=xxx&state=xxx
 *
 * Jackson redirects here after the SAML/OIDC handshake completes.
 * 1. Validate CSRF state cookie
 * 2. Exchange code for user profile via Jackson
 * 3. Upsert user in Supabase auth (create if new, look up if existing)
 * 4. Create a Supabase magic-link session and redirect to /dashboard
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code  = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3000";

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/login?error=${encodeURIComponent(error)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(`${appUrl}/login?error=missing_code`);
  }

  // CSRF validation
  const storedState = req.cookies.get("sso_state")?.value;
  if (!storedState || storedState !== state) {
    return NextResponse.redirect(`${appUrl}/login?error=invalid_state`);
  }

  // We need the tenant (account_id) to call Jackson. Jackson embeds it in the
  // token if we use the client_id=tenant=... pattern, but since we initiated with
  // that, we just pass empty strings — Jackson resolves from the code.
  let profile: Awaited<ReturnType<typeof exchangeCodeForProfile>>;
  try {
    profile = await exchangeCodeForProfile({
      code,
      redirectUri: `${appUrl}/api/sso/callback`,
      tenant:      "",
      product:     "prism",
    });
  } catch (err) {
    console.error("SSO callback: Jackson exchange failed", err);
    return NextResponse.redirect(`${appUrl}/login?error=sso_exchange_failed`);
  }

  if (!profile.email) {
    return NextResponse.redirect(`${appUrl}/login?error=no_email`);
  }

  const admin = createAdminClient();

  // Upsert user in Supabase auth
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let { data: { user }, error: upsertErr } = await (admin as any).auth.admin.getUserByEmail(
    profile.email,
  ) as { data: { user: { id: string } | null }; error: unknown };

  if (!user) {
    // New user — create via admin
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error: createErr } = await (admin as any).auth.admin.createUser({
      email:          profile.email,
      email_confirmed: true,
      user_metadata: {
        full_name:  [profile.firstName, profile.lastName].filter(Boolean).join(" ") || profile.email,
        sso_login:  true,
      },
    }) as { data: { user: { id: string } } | null; error: unknown };

    if (createErr || !created?.user) {
      console.error("SSO callback: failed to create user", createErr);
      return NextResponse.redirect(`${appUrl}/login?error=user_creation_failed`);
    }
    user = created.user;
    upsertErr = null;
  }

  if (upsertErr || !user) {
    return NextResponse.redirect(`${appUrl}/login?error=user_lookup_failed`);
  }

  // Generate a one-time magic link to create a real session
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linkData, error: linkErr } = await (admin as any).auth.admin.generateLink({
    type:  "magiclink",
    email: profile.email,
  }) as { data: { properties: { action_link: string } } | null; error: unknown };

  if (linkErr || !linkData?.properties?.action_link) {
    console.error("SSO callback: failed to generate session link", linkErr);
    return NextResponse.redirect(`${appUrl}/login?error=session_failed`);
  }

  // The action_link is a Supabase-hosted confirm URL. Strip the base and rewrite
  // to our own /auth/confirm route so we can handle the redirect ourselves.
  const actionUrl = new URL(linkData.properties.action_link);
  const token = actionUrl.searchParams.get("token");
  const type  = actionUrl.searchParams.get("type");

  const confirmUrl = new URL(`${appUrl}/auth/confirm`);
  if (token) confirmUrl.searchParams.set("token_hash", token);
  if (type)  confirmUrl.searchParams.set("type", type);
  confirmUrl.searchParams.set("next", "/dashboard");

  const res = NextResponse.redirect(confirmUrl.toString());

  // Clear the CSRF state cookie
  res.cookies.set("sso_state", "", { maxAge: 0, path: "/" });

  return res;
}
