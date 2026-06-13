import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { redis } from "@/lib/upstash/redis";
import { queryTinybird } from "@/lib/tinybird/client";

export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const sp       = req.nextUrl.searchParams;
  const fromDate = sp.get("from_date") ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) + " 00:00:00";
  const toDate   = sp.get("to_date")   ?? new Date().toISOString().slice(0, 10) + " 23:59:59";
  const layer    = sp.get("layer")     ?? "";

  const today    = new Date().toISOString().slice(0, 10);
  const redisKey = `rejection:counts:${member.org_id}:${today}`;

  const [todayCounts, trends] = await Promise.all([
    redis.hgetall<Record<string, number>>(redisKey).catch(() => null),
    queryTinybird("gateway_enforcement_trends", {
      org_id:    member.org_id,
      from_date: fromDate,
      to_date:   toDate,
      ...(layer ? { layer } : {}),
    }).catch(() => []),
  ]);

  return NextResponse.json({
    today:  todayCounts ?? {},
    trends: Array.isArray(trends) ? trends : [],
  });
}
