import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { resolveMetricsScope, forbiddenScope } from "@/lib/supabase/metrics-scope";
import { getSpendByProject } from "@/lib/tinybird/queries";
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
  from:        z.string().default(thirtyDaysAgo),
  to:          z.string().default(today),
  project_id:  z.string().optional().default(""),
  environment: z.string().optional().default(""),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const params = QuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams),
  );
  if (!params.success) {
    return NextResponse.json({ error: params.error.flatten() }, { status: 400 });
  }

  const scope = await resolveMetricsScope(ctx, params.data.project_id);
  if (scope.kind === "forbidden") return forbiddenScope();
  if (scope.kind === "empty") return NextResponse.json({ data: [] });

  const data = await getSpendByProject(
    ctx.orgId,
    params.data.from,
    params.data.to,
    { projectId: scope.projectId, projectIds: scope.projectIds, environment: params.data.environment },
  );

  return NextResponse.json({ data });
}
