/**
 * Cron: purge expired captured content (PRD-0 retention).
 *
 * Deletes request_logs rows whose payload TTL (`expires_at`) has passed. The
 * analytics metadata lives in Tinybird (llm_events) and is unaffected — this
 * only reaps the opt-in content store.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (same guard as the other crons).
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const runtime     = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = req.headers.get("authorization")?.replace("Bearer ", "");
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error, count } = await (admin as any)
    .from("request_logs")
    .delete({ count: "exact" })
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("[purge-content] delete failed:", error.message ?? error);
    return NextResponse.json({ error: "purge_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, purged: count ?? 0 });
}
