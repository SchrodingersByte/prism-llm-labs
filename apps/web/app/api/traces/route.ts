import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT     = 200;
const VALID_STATUS  = ["active", "completed", "error"] as const;

/**
 * GET /api/traces?from&to&status&session_id&limit
 *
 * Lists the org's traces newest-first (by started_at) from the `traces` rollup
 * table that the gateway's trace-writer keeps current. This is the discovery
 * surface that pairs with the existing per-trace detail API
 * (GET /api/traces/[traceId]); together they make the Trace Engine browsable.
 *
 * Auth + org-scoping mirror app/api/traces/[traceId]/route.ts: session user →
 * getMemberOrg → admin client with an explicit org_id filter.
 *
 *   from / to    — ISO timestamps, filter on started_at (inclusive)
 *   status       — active | completed | error
 *   session_id   — only traces whose root_session_id matches
 *   limit        — 1..200 (default 50)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const sp        = req.nextUrl.searchParams;
  const from      = sp.get("from");
  const to        = sp.get("to");
  const status    = sp.get("status");
  const sessionId = sp.get("session_id");
  const limitRaw  = parseInt(sp.get("limit") ?? "", 10);
  const limit     = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const admin = createAdminClient() as SupabaseClient<Database>;

  let query = admin
    .from("traces")
    .select("trace_id, status, total_cost_usd, started_at, ended_at, root_session_id, root_span_id, created_at")
    .eq("org_id", member.org_id);

  if (status && (VALID_STATUS as readonly string[]).includes(status)) {
    query = query.eq("status", status);
  }
  if (sessionId) query = query.eq("root_session_id", sessionId);
  if (from)      query = query.gte("started_at", from);
  if (to)        query = query.lte("started_at", to);

  const { data, error } = await query
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Failed to list traces" }, { status: 500 });
  }

  return NextResponse.json({ traces: data ?? [] }, {
    headers: { "Cache-Control": "private, max-age=10" },
  });
}
