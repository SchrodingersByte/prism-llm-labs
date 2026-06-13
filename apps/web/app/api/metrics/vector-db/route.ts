/**
 * GET /api/metrics/vector-db
 *
 * Returns vector DB cost breakdown from two sources:
 * 1. Tinybird mcp_tool_events filtered by downstream_resource (estimated costs)
 * 2. Supabase mcp_cost_reconciliation grouped by resource_name (actual reconciled costs)
 *
 * Both datasets are returned separately so the UI can show estimated vs actual.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getVectorDbCostBreakdown } from "@/lib/tinybird/queries";

function thirtyDaysAgo() {
  return new Date(Date.now() - 30 * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
}
function today() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from        = req.nextUrl.searchParams.get("from")        ?? thirtyDaysAgo();
  const to          = req.nextUrl.searchParams.get("to")          ?? today();
  const environment = req.nextUrl.searchParams.get("environment") ?? null;

  // Tinybird: estimated costs from event stream (only populated when downstream_resource is set)
  const estimated = await getVectorDbCostBreakdown(member.org_id, from, to);

  // Supabase: actual reconciled costs by resource_name + operation_type
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let reconQuery = (admin as any)
    .from("mcp_cost_reconciliation")
    .select("resource_name, operation_type, actual_cost, cost_source, environment, reconciled_at")
    .eq("org_id", member.org_id)
    .not("resource_name", "is", null)
    .gte("reconciled_at", from.replace(" ", "T") + "Z")
    .lte("reconciled_at", to.replace(" ", "T") + "Z");

  if (environment) reconQuery = reconQuery.eq("environment", environment);

  const { data: reconRows } = await reconQuery as {
    data: Array<{
      resource_name:  string;
      operation_type: string | null;
      actual_cost:    number;
      cost_source:    string;
      environment:    string | null;
      reconciled_at:  string;
    }> | null
  };

  // Aggregate reconciliation rows by resource_name + operation_type
  const reconByResource: Record<string, { total_actual: number; operations: Record<string, number> }> = {};
  for (const row of reconRows ?? []) {
    const key = row.resource_name;
    if (!reconByResource[key]) reconByResource[key] = { total_actual: 0, operations: {} };
    reconByResource[key]!.total_actual += row.actual_cost;
    const opKey = row.operation_type ?? "total";
    reconByResource[key]!.operations[opKey] = (reconByResource[key]!.operations[opKey] ?? 0) + row.actual_cost;
  }

  return NextResponse.json({
    estimated,
    reconciled: Object.entries(reconByResource).map(([resource, data]) => ({
      resource,
      total_actual_usd: data.total_actual,
      operations:       data.operations,
    })),
  });
}
