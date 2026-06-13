import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { checkFeature } from "@/lib/billing/feature-guard";
import { getAgentLoops } from "@/lib/tinybird/queries";

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
  // agent_loop_detection has no project dimension → owner/admin only.
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const guard = await checkFeature(member.org_id, "agents_loop_detection");
  if (guard) return guard;

  const from     = req.nextUrl.searchParams.get("from")      ?? thirtyDaysAgo();
  const to       = req.nextUrl.searchParams.get("to")        ?? today();
  const minCalls = parseInt(req.nextUrl.searchParams.get("min_calls") ?? "5", 10);

  const data = await getAgentLoops(member.org_id, from, to, minCalls);
  return NextResponse.json({ data });
}
