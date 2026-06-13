/**
 * GET /api/metrics/prompt-versions
 *
 * Returns prompt version analytics — cost and latency metrics grouped by
 * system_prompt_hash (auto-captured by the SDK) or system_prompt_version tag.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { queryTinybird } from "@/lib/tinybird/client";
import { z } from "zod";

export interface PromptVersionRow {
  prompt_hash:          string;
  prompt_label:         string;
  requests:             number;
  total_cost_usd:       number;
  avg_cost_per_request: number;
  avg_latency_ms:       number;
  first_seen:           string;
  last_seen:            string;
}

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from:       z.string().default(thirtyDaysAgo),
  to:         z.string().default(today),
  project_id: z.string().uuid().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    const data = await queryTinybird("spend_by_prompt_version", {
      org_id:     ctx.orgId,
      from_date:  params.data.from,
      to_date:    params.data.to,
      project_id: params.data.project_id ?? "",
    }) as PromptVersionRow[];

    return NextResponse.json({ data });
  } catch (e) {
    console.error("prompt-versions metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch prompt version metrics" }, { status: 500 });
  }
}
