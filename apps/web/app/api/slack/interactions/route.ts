/**
 * POST /api/slack/interactions
 *
 * Handles interactive component callbacks from Slack (button clicks in Block Kit).
 * Currently handles:
 *   approve_model:<requestId>  â€” approve a model governance request
 *   deny_model:<requestId>     â€” deny a model governance request
 */
import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature } from "@/lib/slack/verify";
import { createAdminClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    return NextResponse.json({ error: "Slack not configured" }, { status: 501 });
  }

  const rawBody   = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp") ?? "";
  const signature = req.headers.get("x-slack-signature")         ?? "";

  if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: {
    type:     string;
    actions?: Array<{ action_id?: string; value?: string }>;
    team?:    { id?: string };
    user?:    { id?: string };
  };

  try {
    const encoded = new URLSearchParams(rawBody).get("payload") ?? "{}";
    payload = JSON.parse(encoded);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    return new NextResponse(null, { status: 200 });
  }

  const action    = payload.actions?.[0];
  const actionId  = action?.action_id ?? "";
  const requestId = action?.value     ?? "";
  const teamId    = payload.team?.id  ?? "";

  // Resolve the Prism org from the Slack team
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: install } = await (admin as any)
    .from("slack_installations")
    .select("org_id")
    .eq("slack_team_id", teamId)
    .maybeSingle() as { data: { org_id: string } | null };

  if (!install) {
    return new NextResponse(null, { status: 200 }); // Ack silently
  }

  if (actionId.startsWith("approve_model:")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("model_approval_requests" as any)
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("org_id", install.org_id);

    return NextResponse.json({
      response_action: "update",
      view: null,
      text: `âœ… Model request \`${requestId}\` approved.`,
    });
  }

  if (actionId.startsWith("deny_model:")) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("model_approval_requests" as any)
      .update({ status: "denied", reviewed_at: new Date().toISOString() })
      .eq("id", requestId)
      .eq("org_id", install.org_id);

    return NextResponse.json({
      response_action: "update",
      view: null,
      text: `âŒ Model request \`${requestId}\` denied.`,
    });
  }

  return new NextResponse(null, { status: 200 });
}
