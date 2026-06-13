import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { resolveMetricsScopeFor, forbiddenScope } from "@/lib/supabase/metrics-scope";
import { checkFeature } from "@/lib/billing/feature-guard";
import { getSpendByMcpServer } from "@/lib/tinybird/queries";

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

  const guard = await checkFeature(member.org_id, "mcp_analytics");
  if (guard) return guard;

  const from = req.nextUrl.searchParams.get("from") ?? thirtyDaysAgo();
  const to   = req.nextUrl.searchParams.get("to")   ?? today();

  const scope = await resolveMetricsScopeFor(user.id, member.org_id, req.nextUrl.searchParams.get("project_id") ?? "");
  if (scope.kind === "forbidden") return forbiddenScope();
  if (scope.kind === "empty") return NextResponse.json({ data: [] });
  const projectIds = scope.projectId ? [scope.projectId] : scope.projectIds;

  const data = await getSpendByMcpServer(member.org_id, from, to, projectIds);
  return NextResponse.json({ data });
}
