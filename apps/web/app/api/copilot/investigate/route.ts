/**
 * POST /api/copilot/investigate (PRD-7)
 *
 * Agentic root-cause analysis: investigates a cost/quality anomaly across
 * multiple catalogued pipe calls (anomaly_detection → spend_by_model/provider/
 * feature) and returns a narrative + the most likely driver. Same auth + scope as
 * /api/copilot/chat. Reused by an (opt-in) anomaly auto-invoke hook later.
 * Body: { question?, project_id? }. Returns { answer, provenance, data }.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { resolveMetricsScope } from "@/lib/supabase/metrics-scope";
import { runCopilot } from "@/lib/copilot/agent";

export const runtime     = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  question:   z.string().max(2000).optional(),
  project_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const blocked = await checkFeature(ctx.orgId, "engine");
  if (blocked) return blocked;

  let body: unknown = {};
  try { body = await req.json(); } catch { /* empty body is allowed */ }
  const parsed = BodySchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });

  const scope = await resolveMetricsScope(ctx, parsed.data.project_id ?? "");
  if (scope.kind === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (scope.kind === "empty")     return NextResponse.json({ error: "No accessible projects" }, { status: 403 });

  const question = parsed.data.question
    || "Investigate any recent cost anomaly: find when spend spiked and what drove it (model, provider, or feature).";

  const result = await runCopilot({
    orgId:   ctx.orgId,
    scope:   { projectId: scope.projectId, projectIds: scope.projectIds },
    question,
    rcaMode: true,
  });

  return NextResponse.json({ answer: result.answer, provenance: result.provenance, data: result.data });
}
