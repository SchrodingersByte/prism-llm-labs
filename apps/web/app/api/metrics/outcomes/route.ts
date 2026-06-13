import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { queryTinybird } from "@/lib/tinybird/client";
import { z } from "zod";

export interface OutcomeMetricsRow {
  feature_tag:            string;
  total_cost_usd:         number;
  total_requests:         number;
  successful_outcomes:    number;
  failed_outcomes:        number;
  total_value_usd:        number;
  actual_cost_per_success: number;
  roi_ratio:              number;
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
  const ctx = await requireAuth({ roles: ["owner", "administrator"] });
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    const data = await queryTinybird("cost_per_outcome", {
      org_id:    ctx.orgId,
      from_date: params.data.from,
      to_date:   params.data.to,
    }) as OutcomeMetricsRow[];

    // Only return rows that have at least one outcome signal
    const withOutcomes    = data.filter(r => r.successful_outcomes > 0 || r.failed_outcomes > 0);
    const withoutOutcomes = data.filter(r => r.successful_outcomes === 0 && r.failed_outcomes === 0);

    return NextResponse.json({ with_outcomes: withOutcomes, without_outcomes: withoutOutcomes });
  } catch (e) {
    console.error("outcome metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch outcome metrics" }, { status: 500 });
  }
}
