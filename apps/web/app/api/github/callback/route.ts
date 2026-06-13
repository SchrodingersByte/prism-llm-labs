/**
 * GitHub App callback.
 * GET /api/github/callback?code=...&state=...&installation_id=...
 *
 * GitHub App installations send both `code` (OAuth user token) and
 * `installation_id` (app installation scoped to repos). We capture both.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { encryptKey } from "@/lib/crypto/keys";

export async function GET(req: NextRequest) {
  const code           = req.nextUrl.searchParams.get("code");
  const state          = req.nextUrl.searchParams.get("state");
  const installationId = req.nextUrl.searchParams.get("installation_id") ?? null;

  if (!code || !state) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=github_oauth_missing`);
  }

  let parsed: { orgId: string; userId: string; returnTo: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString());
  } catch {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=github_state_invalid`);
  }

  // Exchange code for access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id:     process.env.GITHUB_CLIENT_ID!,
      client_secret: process.env.GITHUB_CLIENT_SECRET!,
      code,
      redirect_uri:  `${process.env.NEXT_PUBLIC_APP_URL}/api/github/callback`,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string; scope?: string; error?: string };
  if (!tokenData.access_token) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=github_token_failed`);
  }

  // Fetch GitHub user info
  const ghUser = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
  }).then(r => r.json()) as { login: string; id: number; avatar_url?: string };

  if (!process.env.ENCRYPTION_SECRET) {
    console.error("ENCRYPTION_SECRET not configured — cannot store GitHub token");
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/dashboard?error=server_config`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Write to scm_connections (new generic table)
  const { error: upsertError } = await admin.from("scm_connections").upsert(
    {
      org_id:              parsed.orgId,
      user_id:             parsed.userId,
      provider:            "github",
      provider_account_id: String(ghUser.id),
      provider_login:      ghUser.login,
      access_token:        encryptKey(tokenData.access_token),
      installation_id:     installationId,
      scope:               tokenData.scope ?? "",
      avatar_url:          ghUser.avatar_url ?? null,
    },
    { onConflict: "org_id,provider,provider_account_id" },
  );

  if (upsertError) {
    console.error("scm_connections upsert failed:", upsertError);
    // Fall back to legacy table so the flow still works during migration
    await admin.from("github_connections").upsert(
      {
        org_id:         parsed.orgId,
        user_id:        parsed.userId,
        access_token:   encryptKey(tokenData.access_token),
        github_login:   ghUser.login,
        github_user_id: ghUser.id,
        scope:          tokenData.scope ?? "",
      },
      { onConflict: "org_id,github_user_id" },
    );
  }

  const sep = parsed.returnTo.includes("?") ? "&" : "?";
  return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}${parsed.returnTo}${sep}github=connected`);
}
