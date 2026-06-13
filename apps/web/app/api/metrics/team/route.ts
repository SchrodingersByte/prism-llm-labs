import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { getSpendByTeam } from "@/lib/tinybird/queries";
import { z } from "zod";

function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}

function today() {
  return new Date().toISOString().slice(0, 10) + " 23:59:59";
}

const QuerySchema = z.object({
  from: z.string().default(thirtyDaysAgo),
  to:   z.string().default(today),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json({ error: params.error.flatten() }, { status: 400 });
  }

  const data = await getSpendByTeam(
    ctx.orgId,
    params.data.from,
    params.data.to,
  );

  return NextResponse.json({ data });
}
