/**
 * Opt-in gateway request/response logger.
 *
 * Thin adapter over the unified content store (`lib/content/store.ts`). The
 * gateway calls writeRequestLog() only when the API key has
 * prompt_logging_enabled = true; writeContent() then resolves the effective
 * capture level (an explicit content_capture_settings row wins; otherwise the
 * legacy flag maps to redacted/full based on the org's PII config) and persists
 * to request_logs. Never blocks the caller.
 *
 * `getOrgPiiConfig` is re-exported for the gateway's pre-flight PII detection.
 */
import { writeContent, getOrgPiiConfig, type OrgPiiConfig } from "@/lib/content/store";

export { getOrgPiiConfig };
export type { OrgPiiConfig };

export interface RequestLogEntry {
  orgId:        string;
  apiKeyId:     string;
  projectId:    string;
  model:        string;
  provider:     string;
  prompt:       unknown[] | null;    // messages array or null
  completion:   string | null;
  inputTokens:  number;
  outputTokens: number;
  costUsd:      number;
  latencyMs:    number;
  statusCode:   number;
  sessionId:    string;
  gitBranch:    string;
  gitAuthor:    string;
  keyType:      string;
  routedFrom:   string;
  traceId?:     string;
  spanId?:      string;
}

export async function writeRequestLog(entry: RequestLogEntry): Promise<void> {
  await writeContent({
    orgId:        entry.orgId,
    source:       "gateway",
    apiKeyId:     entry.apiKeyId,
    projectId:    entry.projectId,
    model:        entry.model,
    provider:     entry.provider,
    prompt:       entry.prompt,
    completion:   entry.completion,
    inputTokens:  entry.inputTokens,
    outputTokens: entry.outputTokens,
    costUsd:      entry.costUsd,
    latencyMs:    entry.latencyMs,
    statusCode:   entry.statusCode,
    sessionId:    entry.sessionId,
    gitBranch:    entry.gitBranch,
    gitAuthor:    entry.gitAuthor,
    keyType:      entry.keyType,
    routedFrom:   entry.routedFrom,
    traceId:      entry.traceId,
    spanId:       entry.spanId,
    // The gateway only reaches this path when prompt_logging_enabled = true.
    promptLoggingEnabled: true,
  });
}
