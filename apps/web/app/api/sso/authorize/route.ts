import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getAuthorizeUrl } from "@/lib/jackson/client";
import { isConfigured as jacksonConfigured } from "@/lib/jackson/client";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/sso/authorize?domain=company.com
 *
 * Looks up an active SSO config for the email domain, then redirects
 * the browser to Jackson's OAuth2 authorize URL. Jackson handles the
 * SAML/OIDC handshake and eventually calls our /api/sso/callback.
 */
export async function GET(req: NextRequest) {
  if (!jacksonConfigured()) {
    return NextResponse.json({ error: "SSO not available" }, { status: 503 });
  }

  const domain = req.nextUrl.searchParams.get("domain")?.toLowerCase().trim();
  if (!domain) {
    return NextResponse.json({ error: "domain param required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Find an active SSO config matching this domain
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: config } = await (admin as any)
    .from("sso_configs")
    .select("account_id, jackson_client_id")
    .eq("domain", domain)
    .eq("is_active", true)
    .maybeSingle() as { data: { account_id: string; jackson_client_id: string | null } | null };

  if (!config) {
    return NextResponse.json(
      { error: "No SSO configuration found for this domain" },
      { status: 404 },
    );
  }

  // CSRF state: random token stored in a short-lived cookie
  const state = crypto.randomBytes(16).toString("hex");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://localhost:3000";

  const authorizeUrl = getAuthorizeUrl({
    tenant:      config.account_id,
    product:     "prism",
    redirectUri: `${appUrl}/api/sso/callback`,
    state,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set("sso_state", state, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   300, // 5 minutes
    path:     "/",
  });

  return res;
}
