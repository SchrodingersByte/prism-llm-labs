/**
 * GET /api/slack/callback
 * Handles the OAuth callback from Slack after workspace authorization.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { encryptKey } from "@/lib/crypto/keys";

export async function GET(req: NextRequest) {
  const code  = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/settings/integrations`;

  if (error || !code || !state) {
    return NextResponse.redirect(`${dashboardUrl}?notice=slack_cancelled`);
  }

  let orgId: string;
  let userId: string;
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    orgId  = parsed.orgId  as string;
    userId = parsed.userId as string;
  } catch {
    return NextResponse.redirect(`${dashboardUrl}?notice=slack_error`);
  }

  const clientId     = process.env.SLACK_CLIENT_ID!;
  const clientSecret = process.env.SLACK_CLIENT_SECRET!;
  const redirectUri  = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/slack/callback`;

  // Exchange code for tokens
  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
  });

  const tokenJson = await tokenRes.json() as {
    ok:         boolean;
    access_token?: string;
    bot_user_id?:  string;
    team?:         { id?: string; name?: string };
  };

  if (!tokenJson.ok || !tokenJson.access_token) {
    return NextResponse.redirect(`${dashboardUrl}?notice=slack_auth_failed`);
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("slack_installations").upsert(
    {
      org_id:          orgId,
      slack_team_id:   tokenJson.team?.id   ?? "",
      slack_team_name: tokenJson.team?.name ?? "",
      bot_token:       encryptKey(tokenJson.access_token),
      bot_user_id:     tokenJson.bot_user_id ?? "",
      installed_by:    userId,
    },
    { onConflict: "org_id,slack_team_id" },
  );

  return NextResponse.redirect(`${dashboardUrl}?notice=slack_connected`);
}
