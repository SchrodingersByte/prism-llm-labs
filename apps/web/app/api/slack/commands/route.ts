/**
 * POST /api/slack/commands
 *
 * Handles /prism slash commands from Slack.
 * Must respond within 3 seconds; heavy queries use the response_url for deferred replies.
 *
 * Commands:
 *   /prism budget          â€” current month budget status
 *   /prism spend           â€” LLM spend by provider (last 30 days)
 *   /prism approve <id>    â€” approve a model governance request
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { handleBudget, handleSpend, handleUnknown } from "@/lib/slack/commands";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/crypto/keys";
import { buildApprovalBlocks } from "@/lib/slack/blocks";

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: "Slack not configured" }, { status: 501 });
  }

  const rawBody = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature")         ?? "";

  if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const params     = new URLSearchParams(rawBody);
  const command    = params.get("command")      ?? "";
  const text       = (params.get("text") ?? "").trim();
  const teamId     = params.get("team_id")      ?? "";
  const responseUrl = params.get("response_url");

  if (command !== "/prism") {
    return NextResponse.json({ text: `Unknown command: ${command}` });
  }

  // Look up which Prism org this Slack team maps to
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: install } = await (admin as any)
    .from("slack_installations")
    .select("org_id, slack_team_name, bot_token")
    .eq("slack_team_id", teamId)
    .maybeSingle() as {
      data: { org_id: string; slack_team_name: string; bot_token: string } | null;
    };

  if (!install) {
    return NextResponse.json({
      text: "âš ï¸ Prism is not connected to this workspace. Visit your Prism dashboard to reconnect.",
    });
  }

  const orgId   = install.org_id;
  const orgName = install.slack_team_name || "Your Org";

  const subcommand = text.split(/\s+/)[0]?.toLowerCase() ?? "";

  // For slow commands, respond immediately with a processing message
  // and post the real result to responseUrl asynchronously
  if (subcommand === "budget") {
    const result = await handleBudget(orgId, orgName);
    if (responseUrl) {
      void fetch(responseUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...result, replace_original: true }),
      });
    }
    return NextResponse.json(result);
  }

  if (subcommand === "spend") {
    const result = await handleSpend(orgId, orgName);
    if (responseUrl) {
      void fetch(responseUrl, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...result, replace_original: true }),
      });
    }
    return NextResponse.json(result);
  }

  if (subcommand === "approve") {
    const requestId = text.split(/\s+/)[1] ?? "";
    if (!requestId) {
      return NextResponse.json({ text: "Usage: `/prism approve <request-id>`" });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: approvalReq } = await (admin as any)
      .from("model_approval_requests" as any)
      .select("model, users(email)")
      .eq("id", requestId)
      .maybeSingle() as {
        data: { model: string; users: { email: string } | null } | null;
      };

    if (!approvalReq) {
      return NextResponse.json({ text: `âš ï¸ Approval request \`${requestId}\` not found.` });
    }

    return NextResponse.json(
      buildApprovalBlocks(
        requestId,
        approvalReq.model,
        approvalReq.users?.email ?? "unknown",
        "",
      ),
    );
  }

  const result = await handleUnknown(text);
  return NextResponse.json(result);
}
