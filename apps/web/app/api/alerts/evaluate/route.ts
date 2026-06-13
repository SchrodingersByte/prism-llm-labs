import { type NextRequest, NextResponse } from "next/server";
import { evaluateAllOrgs } from "@/lib/alerts/evaluator";

// Called by Vercel Cron every 15 minutes (see vercel.json)
// Also callable manually: GET /api/alerts/evaluate
// Secured via CRON_SECRET env var — set in Vercel project settings
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  // In production, always require CRON_SECRET — missing env var is not a bypass
  if (process.env.NODE_ENV !== "development") {
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const start  = Date.now();
  const result = await evaluateAllOrgs();
  const ms     = Date.now() - start;

  return NextResponse.json({
    ok:       true,
    orgs:     result.orgs,
    fired:    result.fired,
    duration: `${ms}ms`,
  });
}
