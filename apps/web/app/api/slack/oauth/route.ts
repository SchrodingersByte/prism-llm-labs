/**
 * GET /api/slack/oauth
 * Redirects the user to the Slack OAuth consent screen.
 * Called when an org owner clicks "Connect Slack" in settings.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.redirect(new URL("/dashboard", req.url));

  const clientId    = process.env.SLACK_CLIENT_ID;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/slack/callback`;

  if (!clientId) {
    return NextResponse.json({ error: "Slack not configured" }, { status: 501 });
  }

  const state = Buffer.from(JSON.stringify({ orgId: member.org_id, userId: user.id })).toString("base64url");

  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id",    clientId);
  url.searchParams.set("scope",        "commands,chat:write,chat:write.public");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state",        state);

  return NextResponse.redirect(url);
}
