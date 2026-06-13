/**
 * Phase 3A — SSE stream for real-sample validation job.
 * GET /api/engine/validate/[jobId]
 *
 * Opens an SSE connection, starts the validation job if pending,
 * streams progress events, and closes when done.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { redis } from "@/lib/upstash/redis";
import { runRealSampleValidation } from "@/lib/engine/validator";
import { recordValidationResult } from "@/lib/engine/actions";

export const runtime     = "nodejs";
export const maxDuration = 300;

interface JobState {
  status:         "pending" | "running" | "done" | "error";
  orgId:          string;
  // Carried over from POST /api/engine/validate so this endpoint can persist
  // the evidence trail via recordValidationResult() once the job resolves —
  // see lib/engine/actions.ts. null when validation was run "bare" (no recId).
  recId:          string | null;
  recType:        string | null;
  recTitle:       string | null;
  currentModel:   string;
  suggestedModel: string;
  providerKeyId:  string;
  feature:        string;
  traceId?:       string;
  stats:          { avg_input_tokens: number; output_input_ratio: number; cache_hit_rate: number };
  progress:       number;
  total:          number;
  score_so_far:   number;
  result:         unknown | null;
  error:          string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const jobKey = `validation:${params.jobId}`;
  const raw    = await redis.get<string>(jobKey);
  if (!raw) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as JobState;

  // Verify ownership
  if (job.orgId !== ctx.orgId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // If already done, return result immediately as a one-shot SSE
  if (job.status === "done" || job.status === "error") {
    const encoder = new TextEncoder();
    const body = job.status === "done"
      ? `event: done\ndata: ${JSON.stringify(job.result)}\n\n`
      : `event: error\ndata: ${JSON.stringify({ message: job.error })}\n\n`;
    return new NextResponse(encoder.encode(body), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  const encoder = new TextEncoder();
  let ctrl: ReadableStreamDefaultController | null = null;

  function send(event: string, data: unknown) {
    ctrl?.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  }

  const stream = new ReadableStream({
    async start(controller) {
      ctrl = controller;

      // Mark as running
      await redis.set(jobKey, JSON.stringify({ ...job, status: "running" }), { ex: 3600 });
      send("progress", { n: 0, total: 20, score_so_far: 0 });

      try {
        const result = await runRealSampleValidation({
          orgId:          job.orgId,
          currentModel:   job.currentModel,
          suggestedModel: job.suggestedModel,
          providerKeyId:  job.providerKeyId,
          n:              20,
          traceId:        job.traceId,
          onProgress: async (n, total, scoreSoFar) => {
            send("progress", { n, total, score_so_far: scoreSoFar });
            await redis.set(jobKey, JSON.stringify({
              ...job, status: "running", progress: n, total, score_so_far: scoreSoFar,
            }), { ex: 3600 });
          },
        });

        // Persist the evidence trail — and possibly auto-stage — before
        // marking the job done, so a refresh of the recommendation list
        // immediately reflects it. Same hard requirements and fail-open
        // behaviour as the synthetic path in /api/engine/validate.
        if (job.recId && job.recType) {
          await recordValidationResult(job.orgId, {
            id: job.recId, type: job.recType, title: job.recTitle ?? "",
            current_model: job.currentModel, suggested_model: job.suggestedModel, feature: job.feature,
          }, result, job.traceId).catch(() => null);
        }

        await redis.set(jobKey, JSON.stringify({ ...job, status: "done", result }), { ex: 3600 });
        send("done", result);
      } catch (err) {
        const msg = String(err);
        await redis.set(jobKey, JSON.stringify({ ...job, status: "error", error: msg }), { ex: 3600 });
        send("error", { message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
    },
  });
}
