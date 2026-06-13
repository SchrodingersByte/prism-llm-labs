/**
 * AWS Bedrock integration for the Prism gateway.
 *
 * Uses the Bedrock Converse API (unified format across all model families).
 * Supported: Anthropic Claude, Amazon Nova, Meta Llama 3, Mistral, Cohere Command R.
 * Out of scope: legacy Titan text models (require the older /invoke format).
 *
 * Authentication: SigV4 is handled automatically by @aws-sdk/client-bedrock-runtime.
 * Streaming: AWS EventStream (binary) is decoded by the SDK and re-emitted as SSE
 *            in OpenAI chunk format so the existing route.ts TransformStream can parse it.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
import type { OAIRequest } from "./normalizer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BedrockCredentials {
  accessKeyId:     string;
  secretAccessKey: string;
  region:          string;
}

// ── Credential helpers ────────────────────────────────────────────────────────

/**
 * Parse Bedrock credentials stored as JSON in the key_encrypted column.
 * Expected format: {"accessKeyId": "AKIA...", "secretAccessKey": "..."}
 */
export function parseBedrockCredentials(
  decryptedKey: string,
  awsRegion:    string,
): BedrockCredentials {
  let parsed: { accessKeyId?: string; secretAccessKey?: string };
  try {
    parsed = JSON.parse(decryptedKey) as { accessKeyId?: string; secretAccessKey?: string };
  } catch {
    throw new Error("Bedrock credentials must be JSON with accessKeyId + secretAccessKey");
  }
  if (!parsed.accessKeyId || !parsed.secretAccessKey) {
    throw new Error("Bedrock credentials missing accessKeyId or secretAccessKey");
  }
  return {
    accessKeyId:     parsed.accessKeyId,
    secretAccessKey: parsed.secretAccessKey,
    region:          awsRegion || "us-east-1",
  };
}

// ── OAI → Bedrock Converse format ─────────────────────────────────────────────

function oaiToBedrockConverse(body: OAIRequest): Record<string, unknown> {
  // System messages become a separate top-level array in Bedrock format
  const system = body.messages
    .filter(m => m.role === "system")
    .map(m => ({ text: typeof m.content === "string" ? m.content : "" }));

  // Non-system messages mapped to Bedrock content blocks
  const messages = body.messages
    .filter(m => m.role !== "system")
    .map(m => {
      // Tool results: OAI "tool" role → Bedrock "user" role with toolResult block
      if (m.role === "tool") {
        return {
          role: "user" as const,
          content: [{
            toolResult: {
              toolUseId: m.tool_call_id ?? "",
              content:   [{ text: typeof m.content === "string" ? m.content : "" }],
            },
          }],
        };
      }

      const role = m.role === "assistant" ? "assistant" as const : "user" as const;

      // Assistant with tool_calls → toolUse blocks
      if (m.tool_calls?.length) {
        return {
          role,
          content: [
            ...(m.content ? [{ text: typeof m.content === "string" ? m.content : "" }] : []),
            ...m.tool_calls.map(tc => ({
              toolUse: {
                toolUseId: tc.id,
                name:      tc.function.name,
                input:     JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>,
              },
            })),
          ],
        };
      }

      // Regular text message
      const text = typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ text?: string }>).map(b => b.text ?? "").join("");
      return { role, content: [{ text }] };
    });

  // Tool definitions
  const toolConfig = body.tools?.length ? {
    tools: body.tools.map(t => ({
      toolSpec: {
        name:        t.function.name,
        description: t.function.description,
        inputSchema: { json: t.function.parameters ?? { type: "object", properties: {} } },
      },
    })),
  } : undefined;

  return {
    messages,
    ...(system.length ? { system }     : {}),
    ...(toolConfig    ? { toolConfig } : {}),
    inferenceConfig: {
      ...(body.max_tokens  ? { maxTokens:   body.max_tokens }     : {}),
      ...(body.temperature ? { temperature: body.temperature }    : {}),
      ...(body.top_p       ? { topP:        body.top_p as number } : {}),
    },
  };
}

// ── Bedrock response → OAI format ─────────────────────────────────────────────

function bedrockConverseToOAI(resp: ConverseCommandOutput, model: string): Record<string, unknown> {
  const content    = resp.output?.message?.content ?? [];
  const textBlocks = content.filter(b => b.text !== undefined);
  const toolBlocks = content.filter(b => b.toolUse);
  const text       = textBlocks.map(b => b.text ?? "").join("");

  const message: Record<string, unknown> = { role: "assistant", content: text || null };
  if (toolBlocks.length) {
    message.tool_calls = toolBlocks.map((b, i) => ({
      id:       b.toolUse!.toolUseId ?? `call_${i}`,
      type:     "function",
      function: { name: b.toolUse!.name ?? "", arguments: JSON.stringify(b.toolUse!.input ?? {}) },
    }));
    if (!text) message.content = null;
  }

  const stopMap: Record<string, string> = {
    end_turn: "stop", max_tokens: "length", tool_use: "tool_calls", stop_sequence: "stop",
  };

  return {
    id:      `bedrock-${Date.now()}`,
    object:  "chat.completion",
    model,
    choices: [{
      index:         0,
      message,
      finish_reason: stopMap[resp.stopReason ?? "end_turn"] ?? "stop",
      logprobs:      null,
    }],
    usage: {
      prompt_tokens:     resp.usage?.inputTokens  ?? 0,
      completion_tokens: resp.usage?.outputTokens ?? 0,
      total_tokens:      (resp.usage?.inputTokens ?? 0) + (resp.usage?.outputTokens ?? 0),
    },
  };
}

// ── Streaming: EventStream → SSE (OAI chunk format) ──────────────────────────

function bedrockStreamToSSE(
  stream: AsyncIterable<ConverseStreamOutput>,
  model:  string,
  msgId:  string,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const emit = (chunk: Record<string, unknown>): Uint8Array =>
    encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`);

  return new ReadableStream({
    async start(controller) {
      try {
        for await (const event of stream) {
          // Text delta chunk
          const evtDelta = event as { contentBlockDelta?: { delta?: { type?: string; text?: string } } };
          const delta = evtDelta.contentBlockDelta?.delta;
          if (delta?.text) {
            controller.enqueue(emit({
              id: msgId, object: "chat.completion.chunk", model,
              choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
            }));
          }

          // Message stop → emit finish_reason chunk
          const evtStop = event as { messageStop?: { stopReason?: string } };
          if (evtStop.messageStop) {
            const stopMap: Record<string, string> = {
              end_turn: "stop", max_tokens: "length", tool_use: "tool_calls",
            };
            const finishReason = stopMap[evtStop.messageStop.stopReason ?? "end_turn"] ?? "stop";
            controller.enqueue(emit({
              id: msgId, object: "chat.completion.chunk", model,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
            }));
          }

          // Usage metadata → emit final usage chunk (route.ts SSE parser reads this)
          const evtMeta = event as { metadata?: { usage?: { inputTokens?: number; outputTokens?: number } } };
          if (evtMeta.metadata?.usage) {
            const inp = evtMeta.metadata.usage.inputTokens  ?? 0;
            const out = evtMeta.metadata.usage.outputTokens ?? 0;
            controller.enqueue(emit({
              id: msgId, object: "chat.completion.chunk", model,
              choices: [],
              usage: { prompt_tokens: inp, completion_tokens: out, total_tokens: inp + out },
            }));
          }
        }
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Execute a Bedrock Converse API request and return a standard Response.
 *
 * Streaming: returns text/event-stream with OAI chunk format.
 *            The route.ts TransformStream parses it identically to other providers.
 * Non-streaming: returns application/json with OAI chat completion format.
 */
export async function bedrockFetch(
  creds:       BedrockCredentials,
  modelId:     string,
  body:        OAIRequest,
  isStreaming: boolean,
): Promise<Response> {
  const client = new BedrockRuntimeClient({
    region:      creds.region,
    credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
  });

  const converseInput = { modelId, ...oaiToBedrockConverse(body) } as ConverseCommandInput;

  if (isStreaming) {
    const resp  = await client.send(new ConverseStreamCommand(converseInput));
    const msgId = `bedrock-${Date.now()}`;
    return new Response(bedrockStreamToSSE(resp.stream!, modelId, msgId), {
      status:  200,
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  }

  const resp = await client.send(new ConverseCommand(converseInput));
  return new Response(JSON.stringify(bedrockConverseToOAI(resp, modelId)), {
    status:  200,
    headers: { "Content-Type": "application/json" },
  });
}
