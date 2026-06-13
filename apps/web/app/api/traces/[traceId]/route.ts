import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { getTraceView } from "@/lib/traces/service";

export const runtime = "nodejs";

/**
 * GET /api/traces/[traceId]
 *
 * Returns the unified trace view (spans + rollup + linked eval runs + linked
 * recommendations + PII incidents) assembled by lib/traces/service.ts. Auth +
 * org-scoping follow the standard pattern; the service does the org-scoped
 * cross-store stitching.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { traceId: string } },
): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const { traceId } = params;
  if (!traceId) return NextResponse.json({ error: "Missing traceId" }, { status: 400 });

  const view = await getTraceView(member.org_id, traceId);
  return NextResponse.json(view, {
    headers: { "Cache-Control": "private, max-age=10" },
  });
}
