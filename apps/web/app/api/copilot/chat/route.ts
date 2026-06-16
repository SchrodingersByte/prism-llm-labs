/**
 * POST /api/copilot/chat (PRD-7)
 *
 * Body: { question, conversation_id?, project_id? }
 * Auth: requireAuth + checkFeature("engine"); org-scoped via resolveMetricsScope.
 * Runs the read-only Copilot agent over the metrics catalog and persists the turn
 * (with tool-call provenance) to copilot_messages.
 * Returns { conversation_id, answer, provenance, data }.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { resolveMetricsScope } from "@/lib/supabase/metrics-scope";
import { createAdminClient } from "@/lib/supabase/server";
import { runCopilot } from "@/lib/copilot/agent";

export const runtime     = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  question:        z.string().min(1).max(2000),
  conversation_id: z.string().uuid().optional(),
  project_id:      z.string().uuid().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const blocked = await checkFeature(ctx.orgId, "engine");
  if (blocked) return blocked;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Validation failed", details: parsed.error.issues }, { status: 422 });
  const { question, conversation_id, project_id } = parsed.data;

  const scope = await resolveMetricsScope(ctx, project_id ?? "");
  if (scope.kind === "forbidden") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (scope.kind === "empty")     return NextResponse.json({ error: "No accessible projects" }, { status: 403 });

  const admin = createAdminClient();

  // Resolve or create the conversation (must belong to this org).
  let convId = conversation_id ?? null;
  if (convId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conv } = await (admin as any)
      .from("copilot_conversations").select("id").eq("id", convId).eq("org_id", ctx.orgId).maybeSingle();
    if (!conv) convId = null;
  }
  if (!convId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: created, error } = await (admin as any)
      .from("copilot_conversations")
      .insert({ org_id: ctx.orgId, user_id: ctx.user.id, title: question.slice(0, 80) })
      .select("id").single();
    if (error || !created) return NextResponse.json({ error: "Failed to start conversation" }, { status: 500 });
    convId = created.id as string;
  }

  // Persist the user turn.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("copilot_messages")
    .insert({ conversation_id: convId, org_id: ctx.orgId, role: "user", content: question });

  // Run the agent (read-only, org-scoped, self-metered via the gateway).
  const result = await runCopilot({
    orgId: ctx.orgId,
    scope: { projectId: scope.projectId, projectIds: scope.projectIds },
    question,
  });

  // Persist the assistant turn with tool-call provenance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("copilot_messages").insert({
    conversation_id: convId, org_id: ctx.orgId, role: "assistant",
    content: result.answer, tool_calls: result.provenance,
  });

  return NextResponse.json({
    conversation_id: convId,
    answer:          result.answer,
    provenance:      result.provenance,
    data:            result.data,
  });
}
