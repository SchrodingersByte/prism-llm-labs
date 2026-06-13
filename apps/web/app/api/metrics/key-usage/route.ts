import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getSpendByKey, getKeyTimeseries } from "@/lib/tinybird/queries";
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
  key_id: z.string().uuid(),
  from:   z.string().default(thirtyDaysAgo),
  to:     z.string().default(today),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) {
    return NextResponse.json({ error: "key_id (uuid) is required" }, { status: 400 });
  }

  const admin = createAdminClient();
  // Verify the key belongs to this org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: key } = await (admin as any)
    .from("api_keys")
    .select("id, name, key_prefix, environment, last_used_at, created_at")
    .eq("id", params.data.key_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (!key) {
    return NextResponse.json({ error: "Key not found" }, { status: 404 });
  }

  try {
    const [summary, timeseries] = await Promise.all([
      getSpendByKey(ctx.orgId, params.data.from, params.data.to, params.data.key_id),
      getKeyTimeseries(ctx.orgId, params.data.key_id, params.data.from, params.data.to),
    ]);

    return NextResponse.json({
      data: {
        key,
        summary: summary[0] ?? null,
        timeseries,
      },
    });
  } catch (e) {
    console.error("key-usage metrics error:", e);
    return NextResponse.json(
      { error: "Failed to fetch key metrics" },
      { status: 500 },
    );
  }
}
