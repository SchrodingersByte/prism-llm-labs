/**
 * GET /api/content/[eventId] (PRD-0)
 *
 * Returns the captured (redacted) content for one event from request_logs.
 * Authorized via the log-access gate: org managers (owner/administrator) always;
 * other members need an approved log_access_requests row for the event's project.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<NextResponse> {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row } = await (admin as any)
    .from("request_logs")
    .select("id, org_id, project_id, model, provider, prompt, completion, context, tool_io, redaction_level, pii_found, source, trace_id, span_id, created_at")
    .eq("org_id", ctx.orgId)
    .eq("event_id", params.eventId)
    .maybeSingle() as { data: { project_id: string | null } & Record<string, unknown> | null };

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Log-access gate
  let allowed = ctx.canManage;
  if (!allowed && row.project_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: approved } = await (admin as any)
      .from("log_access_requests")
      .select("id")
      .eq("project_id", row.project_id)
      .eq("requester_id", ctx.user.id)
      .eq("status", "approved")
      .maybeSingle();
    allowed = Boolean(approved);
  }
  if (!allowed) {
    return NextResponse.json({ error: "Log access not granted for this project" }, { status: 403 });
  }

  return NextResponse.json({ content: row });
}
