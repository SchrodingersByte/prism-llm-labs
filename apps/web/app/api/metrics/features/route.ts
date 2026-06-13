import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getSpendByFeature, getSpendByAction } from "@/lib/tinybird/queries";

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

  const from = req.nextUrl.searchParams.get("from") ?? thirtyDaysAgo();
  const to   = req.nextUrl.searchParams.get("to")   ?? today();

  const [features, actions] = await Promise.all([
    getSpendByFeature(member.org_id, from, to),
    getSpendByAction(member.org_id, from, to),
  ]);

  return NextResponse.json({ features, actions });
}
