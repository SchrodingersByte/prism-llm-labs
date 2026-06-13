/**
 * GET /api/mcp/reconcile/status?session_ids=id1,id2,...
 *
 * Returns reconciliation status for a batch of session IDs —
 * used by the sessions list page to show which sessions have
 * actual (vs estimated) infra costs.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";

interface ReconcileStatus {
  session_id:       string;
  reconciled_count: number;
  actual_cost_usd:  number;
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const raw = req.nextUrl.searchParams.get("session_ids") ?? "";
  const sessionIds = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, 100);

  if (sessionIds.length === 0) return NextResponse.json({ data: [] });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("mcp_cost_reconciliation")
    .select("session_id, actual_cost_usd")
    .eq("org_id", member.org_id)
    .in("session_id", sessionIds)
    .not("actual_cost_usd", "is", null);

  // Aggregate per session_id (multiple infra providers may each reconcile)
  const bySession = new Map<string, ReconcileStatus>();
  for (const row of (data ?? []) as { session_id: string; actual_cost_usd: number }[]) {
    const existing = bySession.get(row.session_id);
    if (existing) {
      existing.reconciled_count++;
      existing.actual_cost_usd += row.actual_cost_usd ?? 0;
    } else {
      bySession.set(row.session_id, {
        session_id:       row.session_id,
        reconciled_count: 1,
        actual_cost_usd:  row.actual_cost_usd ?? 0,
      });
    }
  }

  return NextResponse.json({ data: Array.from(bySession.values()) });
}
