import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/crypto/keys";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { upsertTraceRollup } from "@/lib/gateway/trace-writer";
import { incrementSpend } from "@/lib/upstash/redis";
import { planToTtlDays, calculateCost } from "@/lib/pricing/table";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

export const runtime = "nodejs";

const MessageSchema = z.object({
  role:    z.enum(["user", "assistant", "system"]),
  content: z.union([z.string(), z.array(z.unknown())]),
});

const BodySchema = z.object({
  provider_key_id: z.string().uuid(),
  model:           z.string().min(1),
  messages:        z.array(MessageSchema).min(1),
  stream:          z.boolean().default(true),
});

const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai:       "https://api.openai.com/v1/chat/completions",
  anthropic:    "https://api.anthropic.com/v1/messages",
  azure_openai: "", // built dynamically from azure_endpoint
  google:       "https://generativelanguage.googleapis.com/v1beta/models",
};

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const { provider_key_id, model, messages, stream } = parsed.data;
  const admin = createAdminClient();

  // Optional distributed-trace context (set by the engine validator so its
  // model calls join one trace). When present, arena spans are stamped with it
  // and rolled up into the traces table, exactly like the gateway hot path.
  const traceId     = req.headers.get("x-prism-trace-id") ?? "";
  const traceSpanId = traceId ? uuidv4().replace(/-/g, "") : "";

  // Verify provider key belongs to this org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pk } = await (admin as any)
    .from("provider_keys")
    .select("id, provider, key_encrypted, azure_endpoint, organizations(plan)")
    .eq("id", provider_key_id)
    .eq("org_id", ctx.orgId)
    .eq("is_active", true)
    .maybeSingle();

  if (!pk) {
    return NextResponse.json({ error: "Provider key not found" }, { status: 404 });
  }

  const providerKey = decryptKey(pk.key_encrypted);
  const provider    = pk.provider as string;
  const orgPlan     = (pk.organizations as { plan?: string } | null)?.plan ?? "starter";

  const t0 = Date.now();

  // ── Build upstream request ────────────────────────────────────────────────
  let upstreamUrl  = PROVIDER_ENDPOINTS[provider] ?? PROVIDER_ENDPOINTS.openai;
  let upstreamBody: unknown = { model, messages, stream };
  const upstreamHeaders: Record<string, string> = { "Content-Type": "application/json" };

  if (provider === "anthropic") {
    upstreamHeaders["x-api-key"]         = providerKey;
    upstreamHeaders["anthropic-version"] = "2023-06-01";
    const typedMsgs = messages as { role: string; content: unknown }[];
    const systemMsg = typedMsgs.find(m => m.role === "system");
    const chatMsgs  = typedMsgs.filter(m => m.role !== "system");
    if (chatMsgs.length === 0) {
      return NextResponse.json({ error: "At least one user or assistant message is required" }, { status: 400 });
    }
    upstreamBody = {
      model,
      messages:   chatMsgs,
      max_tokens: 4096,
      stream,
      ...(systemMsg ? { system: systemMsg.content } : {}),
    };
  } else if (provider === "azure_openai") {
    const azureEndpoint = pk.azure_endpoint as string;
    upstreamUrl  = `${azureEndpoint}/openai/deployments/${model}/chat/completions?api-version=2024-02-01`;
    upstreamHeaders["api-key"] = providerKey;
  } else if (provider === "google") {
    const action = stream ? "streamGenerateContent" : "generateContent";
    upstreamUrl  = `${PROVIDER_ENDPOINTS.google}/${model}:${action}?key=${providerKey}`;
    upstreamBody = {
      contents: (messages as { role: string; content: unknown }[]).map(m => ({
        role:  m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    };
  } else {
    // OpenAI
    upstreamHeaders["Authorization"] = `Bearer ${providerKey}`;
    if (stream) {
      upstreamBody = { ...upstreamBody as object, stream_options: { include_usage: true } };
    }
  }

  // ── Forward to provider ───────────────────────────────────────────────────
  const upstream = await fetch(upstreamUrl, {
    method:  "POST",
    headers: upstreamHeaders,
    body:    JSON.stringify(upstreamBody),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Provider error ${upstream.status}`, detail: errText },
      { status: upstream.status },
    );
  }

  if (!stream || !upstream.body) {
    const data      = await upstream.json();
    const latencyMs = Date.now() - t0;
    // Capture non-streaming usage
    await captureArenaEvent(ctx.orgId, orgPlan, provider, model, data, latencyMs, admin, incrementSpend, traceId, traceSpanId);
    return NextResponse.json(data);
  }

  // ── Stream SSE back to client, intercept final usage chunk ───────────────
  let inputTokens  = 0;
  let outputTokens = 0;
  let cachedTokens = 0;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer   = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            controller.enqueue(encoder.encode(line + "\n"));
            // Parse SSE for usage
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const chunk = JSON.parse(line.slice(6));
                const usage = chunk?.usage;
                if (usage) {
                  // OpenAI uses prompt_tokens/completion_tokens; Anthropic uses input_tokens/output_tokens
                  inputTokens  = usage.input_tokens  ?? usage.prompt_tokens     ?? inputTokens;
                  outputTokens = usage.output_tokens ?? usage.completion_tokens ?? outputTokens;
                  cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? cachedTokens;
                }
              } catch { /* ignore non-JSON lines */ }
            }
          }
        }
        if (buffer) controller.enqueue(encoder.encode(buffer));
      } finally {
        reader.releaseLock();
        controller.close();

        // Capture after stream finishes
        const latencyMs = Date.now() - t0;
        const costUsd   = calculateCost(model, inputTokens, outputTokens, cachedTokens);
        const ttlDays   = planToTtlDays(orgPlan);
        const event = {
          event_id:      uuidv4(),
          timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
          org_id:        ctx.orgId,
          project_id:    "",
          project_name:  "",
          team_id:       "",
          user_id:       ctx.user.id,
          environment:   "arena",
          provider,
          model,
          input_tokens:  inputTokens,
          output_tokens: outputTokens,
          cached_tokens: cachedTokens,
          image_tokens:  0,
          audio_tokens:  0,
          text_tokens:   inputTokens,
          modalities:    "text",
          cost_usd:      costUsd,
          latency_ms:    latencyMs,
          status_code:   200,
          request_id:    uuidv4(),
          api_key_id:    "",
          tags:          { source: "arena" },
          ttl_days:      ttlDays,
          ...(traceId ? { trace_id: traceId, span_id: traceSpanId, parent_span_id: "" } : {}),
        };
        await ingestToTinybird([event]).catch(() => {});
        if (costUsd > 0) await incrementSpend(ctx.orgId, "arena", costUsd).catch(() => {});
        if (traceId) {
          void upsertTraceRollup(ctx.orgId, traceId, {
            rootSpanId: traceSpanId, rootSessionId: null,
            costUsd, startedAt: new Date(t0).toISOString(), endedAt: new Date().toISOString(),
            isError: false,
          });
        }
      }
    },
  });

  return new NextResponse(readable, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Arena":       "1",
    },
  });
}

async function captureArenaEvent(
  orgId: string,
  orgPlan: string,
  provider: string,
  model: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  latencyMs: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  incFn: (orgId: string, project: string, cost: number) => Promise<void>,
  traceId = "",
  spanId  = "",
) {
  try {
    const usage       = data?.usage ?? {};
    const inputTokens  = usage.prompt_tokens     ?? usage.input_tokens     ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens    ?? 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens ?? 0;
    const costUsd      = calculateCost(model, inputTokens, outputTokens, cachedTokens);
    const ttlDays      = planToTtlDays(orgPlan);

    await ingestToTinybird([{
      event_id:      uuidv4(),
      timestamp:     new Date().toISOString().replace("T", " ").slice(0, 23),
      org_id:        orgId,
      project_id:    "",
      project_name:  "",
      team_id:       "",
      user_id:       "",
      environment:   "arena",
      provider,
      model,
      input_tokens:  inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      image_tokens:  0,
      audio_tokens:  0,
      text_tokens:   inputTokens,
      modalities:    "text",
      cost_usd:      costUsd,
      latency_ms:    latencyMs,
      status_code:   200,
      request_id:    data?.id ?? uuidv4(),
      api_key_id:    "",
      tags:          { source: "arena" },
      ttl_days:      ttlDays,
      ...(traceId ? { trace_id: traceId, span_id: spanId, parent_span_id: "" } : {}),
    }]);

    if (costUsd > 0) await incFn(orgId, "arena", costUsd);
    if (traceId) {
      const endedMs = Date.now();
      void upsertTraceRollup(orgId, traceId, {
        rootSpanId: spanId || null, rootSessionId: null,
        costUsd, startedAt: new Date(endedMs - latencyMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
        isError: false,
      });
    }
  } catch { /* never block */ }
  void admin; // used by caller for key validation only
}
