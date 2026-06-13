/**
 * Telemetry export dispatcher â€” fire-and-forget forwarding of LLM events
 * to registered external destinations (Langfuse, Helicone, generic webhooks).
 *
 * Called after every successful Tinybird ingest. Never awaited in the
 * request path â€” failures are logged but do not affect gateway responses.
 */

import { createAdminClient } from "@/lib/supabase/server";

export type DestinationType = "webhook" | "langfuse" | "helicone";

export interface ExportDestination {
  id:           string;
  org_id:       string;
  name:         string;
  type:         DestinationType;
  url:          string;
  secret_token: string | null;
  active:       boolean;
  created_at:   string;
}

interface LLMEventPayload {
  event_id?:      string;
  org_id:         string;
  api_key_id?:    string;
  project_id?:    string;
  model:          string;
  provider:       string;
  input_tokens:   number;
  output_tokens:  number;
  cached_tokens:  number;
  cost_usd:       number;
  latency_ms:     number;
  status_code:    number;
  timestamp:      string;
  tags?:          Record<string, string>;
  session_id?:    string;
}

// â”€â”€ Destination adapters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function toWebhookPayload(event: LLMEventPayload): object {
  return {
    source:    "prism",
    event:     "llm.completion",
    timestamp: event.timestamp,
    data:      event,
  };
}

function toLangfusePayload(event: LLMEventPayload): object {
  // Langfuse ingestion API: https://api.langfuse.com/api/public/ingestion
  return {
    batch: [{
      id:         event.event_id ?? crypto.randomUUID(),
      type:       "generation-create",
      timestamp:  event.timestamp,
      body: {
        traceId:      event.session_id,
        name:         event.tags?.["feature"] ?? event.model,
        model:        event.model,
        input:        null,
        output:       null,
        usage: {
          promptTokens:     event.input_tokens,
          completionTokens: event.output_tokens,
          totalTokens:      event.input_tokens + event.output_tokens,
        },
        metadata: {
          prism_project_id: event.project_id,
          prism_cost_usd:   event.cost_usd,
          provider:         event.provider,
          ...event.tags,
        },
        latency:     event.latency_ms / 1000,
        statusCode:  event.status_code,
      },
    }],
  };
}

function toHeliconePayload(event: LLMEventPayload): object {
  return {
    model:          event.model,
    provider:       event.provider,
    usage: {
      prompt_tokens:     event.input_tokens,
      completion_tokens: event.output_tokens,
      total_tokens:      event.input_tokens + event.output_tokens,
    },
    latency:        event.latency_ms,
    cost:           event.cost_usd,
    properties:     event.tags ?? {},
    request_id:     event.event_id,
    created_at:     event.timestamp,
  };
}

function buildPayload(dest: ExportDestination, event: LLMEventPayload): object {
  switch (dest.type) {
    case "langfuse": return toLangfusePayload(event);
    case "helicone": return toHeliconePayload(event);
    default:         return toWebhookPayload(event);
  }
}

function buildHeaders(dest: ExportDestination): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (dest.secret_token) {
    if (dest.type === "langfuse") {
      // Langfuse uses Basic auth: Base64(publicKey:secretKey)
      headers["Authorization"] = `Basic ${btoa(dest.secret_token)}`;
    } else {
      headers["Authorization"] = `Bearer ${dest.secret_token}`;
    }
  }
  return headers;
}

async function sendToDestination(dest: ExportDestination, event: LLMEventPayload): Promise<void> {
  const body    = JSON.stringify(buildPayload(dest, event));
  const headers = buildHeaders(dest);

  let res = await fetch(dest.url, { method: "POST", headers, body }).catch(() => null);
  if (!res || res.status >= 500) {
    // Retry once on server error
    await new Promise(r => setTimeout(r, 500));
    res = await fetch(dest.url, { method: "POST", headers, body }).catch(() => null);
  }
}

/**
 * Dispatch an LLM event to all active export destinations for the org.
 * Fire-and-forget â€” never awaited in the gateway path.
 */
export function dispatchEvent(event: LLMEventPayload): void {
  // Run completely detached â€” intentionally not awaited
  (async () => {
    try {
      const admin = createAdminClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: destinations } = await (admin as any)
        .from("export_destinations" as any)
        .select("*")
        .eq("org_id", event.org_id)
        .eq("active", true) as { data: ExportDestination[] | null };

      if (!destinations?.length) return;

      await Promise.allSettled(
        destinations.map(dest => sendToDestination(dest, event)),
      );
    } catch {
      // Silent â€” never block the gateway
    }
  })();
}
