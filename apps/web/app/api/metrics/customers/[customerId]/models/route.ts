/**
 * GET /api/metrics/customers/[customerId]/models
 * Per-model spend breakdown for one customer. Manager-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { getCustomerModelBreakdown } from "@/lib/tinybird/queries";

function monthStart() {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10) + " 00:00:00";
}
function today() {
  return new Date().toISOString().slice(0, 10) + " 23:59:59";
}

export async function GET(req: NextRequest, { params }: { params: { customerId: string } }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from") ?? monthStart();
  const to   = sp.get("to")   ?? today();

  const data = await getCustomerModelBreakdown(member.org_id, params.customerId, from, to);
  return NextResponse.json({ data });
}
