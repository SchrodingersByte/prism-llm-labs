/**
 * Phase 3 validation endpoint.
 *
 * POST /api/engine/validate
 * Body: { mode: "synthetic" | "real", recId, currentModel, suggestedModel,
 *         providerKeyId, feature, stats }
 *
 * For "synthetic": runs synchronously with a streaming response (shows progress).
 * For "real": creates a Redis job and returns jobId; client polls /[jobId]/stream.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { checkFeature } from "@/lib/billing/feature-guard";
import { redis } from "@/lib/upstash/redis";
import { runSyntheticValidation } from "@/lib/engine/validator";
import { recordValidationResult } from "@/lib/engine/actions";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

export const runtime    = "nodejs";
export const maxDuration = 300;

const BodySchema = z.object({
  mode:           z.enum(["synthetic", "real"]),
  // Identifies which Recommendation this run is for, so the result can be
  // persisted via recordValidationResult() — see lib/engine/actions.ts.
  // Optional: validation can still run "bare" (e.g. ad-hoc exploration)
  // without recId; it just won't be remembered anywhere.
  recId:          z.string().optional(),
  recType:        z.string().optional(),
  recTitle:       z.string().optional(),
  currentModel:   z.string().min(1),
  suggestedModel: z.string().min(1),
  providerKeyId:  z.string().uuid(),
  feature:        z.string().default(""),
  stats: z.object({
    avg_input_tokens:   z.number().default(400),
    output_input_ratio: z.number().default(0.5),
    cache_hit_rate:     z.number().default(0.3),
  }).default({}),
});

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "engine");
  if (guard) return guard;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { mode, recId, recType, recTitle, currentModel, suggestedModel, providerKeyId, feature, stats } = parsed.data;

  // One trace per validation run: the validator threads this onto its arena
  // model calls (so they surface as spans in the trace tree) and
  // recordValidationResult stores it on the evaluation_runs row — linking the
  // run to its trace and its recommendation.
  const traceId = uuidv4().replace(/-/g, "");

  if (mode === "real") {
    // Phase 3A: create async job, let the SSE endpoint drive it
    const jobId = uuidv4();
    await redis.set(
      `validation:${jobId}`,
      JSON.stringify({
        status:         "pending",
        orgId:          ctx.orgId,
        // Carried through so /[jobId] can call recordValidationResult() once
        // the job resolves — see the JobState extension there.
        recId:          recId   ?? null,
        recType:        recType ?? null,
        recTitle:       recTitle ?? null,
        currentModel,
        suggestedModel,
        providerKeyId,
        feature,
        traceId,
        stats,
        progress:       0,
        total:          20,
        score_so_far:   0,
        result:         null,
        error:          null,
      }),
      { ex: 3600 }, // 1h TTL
    );
    return NextResponse.json({ jobId, mode: "real" });
  }

  // Phase 3B: synthetic — stream progress via SSE
  const encoder = new TextEncoder();
  let controller_: ReadableStreamDefaultController | null = null;

  function sendEvent(event: string, data: unknown) {
    controller_?.enqueue(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      controller_ = controller;
      try {
        const result = await runSyntheticValidation({
          currentModel,
          suggestedModel,
          providerKeyId,
          feature,
          traceId,
          stats,
          onProgress: (n, total) => {
            sendEvent("progress", { n, total, score_so_far: 0 });
          },
        });

        // Persist the evidence trail — and possibly auto-stage — before the
        // client sees "done", so a refresh of the recommendation list
        // immediately reflects it. recId/recType are the only hard
        // requirements (rec_id is the upsert key, rec_type is NOT NULL);
        // title is cosmetic. Never let a persistence hiccup fail validation.
        if (recId && recType) {
          await recordValidationResult(ctx.orgId, {
            id: recId, type: recType, title: recTitle ?? "",
            current_model: currentModel, suggested_model: suggestedModel, feature,
          }, result, traceId).catch(() => null);
        }

        sendEvent("done", result);
      } catch (err) {
        sendEvent("error", { message: String(err) });
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
