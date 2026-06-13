import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { queryTinybird } from "@/lib/tinybird/client";
import { z } from "zod";

export interface TtftRow {
  model:               string;
  provider:            string;
  p50_ttft_ms:         number;
  p90_ttft_ms:         number;
  p99_ttft_ms:         number;
  avg_ttft_ms:         number;
  streaming_requests:  number;
  total_requests:      number;
}

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from: z.string().default(thirtyDaysAgo),
  to:   z.string().default(today),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    const data = await queryTinybird("ttft_percentiles", {
      org_id:    ctx.orgId,
      from_date: params.data.from,
      to_date:   params.data.to,
    }) as TtftRow[];
    return NextResponse.json({ data });
  } catch (e) {
    console.error("ttft metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch TTFT metrics" }, { status: 500 });
  }
}
