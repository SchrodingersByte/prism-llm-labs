import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { getSpendByBranch } from "@/lib/tinybird/queries";
import { z } from "zod";

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from:       z.string().default(thirtyDaysAgo),
  to:         z.string().default(today),
  project_id: z.string().uuid().optional(),
  key_type:   z.enum(["analytics", "gateway"]).optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "branch_attribution");
  if (guard) return guard;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    const data = await getSpendByBranch(
      ctx.orgId,
      params.data.from,
      params.data.to,
      params.data.project_id,
      params.data.key_type,
    );
    return NextResponse.json({ data });
  } catch (e) {
    console.error("branches metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch branch metrics" }, { status: 500 });
  }
}
