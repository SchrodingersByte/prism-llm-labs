/**
 * Copilot planner agent (PRD-7).
 *
 * A bounded tool-use loop over the metrics catalog. The planner model may only
 * call `query_metrics(pipe, params)`; the runner rejects any non-catalogued pipe,
 * injects org_id + project scope, runs queryTinybird (read-only, edge-cached),
 * and feeds the rows back. After ≤ MAX_STEPS model turns it returns a narrative +
 * provenance (which pipes ran, with what params, and how many rows).
 *
 * Transport: Prism's OWN gateway when PRISM_INTERNAL_KEY is set (self-metered /
 * capped — same lock as PRD-1), else a direct Anthropic call. The agent is
 * read-only and org-scoped — it never runs raw SQL and never writes.
 *
 * Design: docs/implementation/07-prism-copilot-nl-agentic-rca.impl.md §4.2
 */
import { queryTinybird } from "@/lib/tinybird/client";
import { CATALOG, INJECTED_PARAMS, isCatalogPipe, renderCatalog } from "./catalog";

const APP_URL          = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.PRISM_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const ANTHROPIC_DIRECT = "https://api.anthropic.com/v1/messages";
const PLANNER_MODEL    = process.env.COPILOT_MODEL || "claude-sonnet-4-6";
const MAX_STEPS        = 6;    // model turns (each may issue >=1 pipe call)
const MAX_ROWS_BACK    = 50;   // rows fed back to the model per pipe call

export interface CopilotScope { projectId: string; projectIds: string[] }
export interface ProvenanceEntry { pipe: string; params: Record<string, string>; rows: number }
export interface CopilotResult {
  answer:     string;
  provenance: ProvenanceEntry[];
  data:       Record<string, unknown[]>;   // pipe → (capped) rows, for chart rendering
  steps:      number;
}

// ── Minimal Anthropic Messages shapes (tool use) ──────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Block = { type: string; text?: string; id?: string; name?: string; input?: any };
interface AnthroResp { content?: Block[]; stop_reason?: string }

const TOOL = {
  name: "query_metrics",
  description:
    "Query one Prism analytics pipe and get JSON rows back. You may ONLY use the catalogued pipes. " +
    "org_id and project scope are injected automatically — never include them. Dates use 'YYYY-MM-DD HH:MM:SS'.",
  input_schema: {
    type: "object",
    properties: {
      pipe:   { type: "string", enum: CATALOG.map(e => e.pipe), description: "The pipe to query." },
      params: { type: "object", description: "Pipe params, e.g. { \"from_date\": \"2026-05-01 00:00:00\", \"to_date\": \"2026-06-01 00:00:00\" }." },
    },
    required: ["pipe"],
  },
};

function tbNow(): string { return new Date().toISOString().replace("T", " ").slice(0, 19); }
function tbDaysAgo(n: number): string { return new Date(Date.now() - n * 86_400_000).toISOString().replace("T", " ").slice(0, 19); }

function baseSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10);
  return [
    "You are Prism Copilot, an AI FinOps + LLM-observability analyst for ONE organization.",
    "Answer the user's question by calling the query_metrics tool on the catalogued pipes, then summarizing the findings.",
    `Today is ${today}. If no period is given, default to the last 30 days. Dates use 'YYYY-MM-DD HH:MM:SS'.`,
    "Rules: only use the pipes listed below; never ask for or pass org_id/project (they are injected); keep tool calls focused (a few at most);",
    "once you have enough data, give a concise, specific answer that cites the key numbers. If a pipe returns no rows, say the data isn't available yet.",
    "",
    "Available pipes:",
    renderCatalog(),
  ].join("\n");
}

function rcaSystemPrompt(): string {
  return baseSystemPrompt() + "\n\n" + [
    "INVESTIGATION MODE: the user is investigating a cost or quality anomaly.",
    "Start with anomaly_detection to locate the spike date, then decompose it by spend_by_model, spend_by_provider, and spend_by_feature to find the driver.",
    "Conclude with the single most likely root cause and a one-line recommended action.",
  ].join("\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callModel(system: string, messages: any[]): Promise<AnthroResp | null> {
  const body = JSON.stringify({
    model:       PLANNER_MODEL,
    max_tokens:  1500,
    system,
    messages,
    tools:       [TOOL],
    tool_choice: { type: "auto" },
  });
  const internalKey = process.env.PRISM_INTERNAL_KEY;
  try {
    if (internalKey) {
      // Self-metered via Prism's own gateway.
      const res = await fetch(`${APP_URL}/api/gateway/anthropic/v1/messages`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${internalKey}` },
        body,
      });
      if (!res.ok) return null;
      return await res.json() as AnthroResp;
    }
    const directKey = process.env.ANTHROPIC_API_KEY;
    if (!directKey) return null;
    const res = await fetch(ANTHROPIC_DIRECT, {
      method:  "POST",
      headers: { "x-api-key": directKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body,
    });
    if (!res.ok) return null;
    return await res.json() as AnthroResp;
  } catch {
    return null;
  }
}

/** Merge model params with the runner-injected org_id + project scope + a default window. */
function buildParams(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modelParams: Record<string, any> | undefined,
  orgId:       string,
  scope:       CopilotScope,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(modelParams ?? {})) {
    if ((INJECTED_PARAMS as readonly string[]).includes(k)) continue;  // never let the model set scope
    if (v === null || v === undefined) continue;
    out[k] = String(v);
  }
  if (!out.from_date) out.from_date = tbDaysAgo(30);
  if (!out.to_date)   out.to_date   = tbNow();
  out.org_id = orgId;                                                   // hard org scope
  if (scope.projectId)        out.project_id  = scope.projectId;
  if (scope.projectIds.length) out.project_ids = scope.projectIds.join(",");
  return out;
}

function stripInternal(params: Record<string, string>): Record<string, string> {
  // Don't echo org_id back in provenance (it's implicit).
  const { org_id, ...rest } = params;  // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export async function runCopilot(opts: {
  orgId:    string;
  scope:    CopilotScope;
  question: string;
  rcaMode?: boolean;
}): Promise<CopilotResult> {
  const system = opts.rcaMode ? rcaSystemPrompt() : baseSystemPrompt();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages: any[] = [{ role: "user", content: opts.question }];
  const provenance: ProvenanceEntry[] = [];
  const data: Record<string, unknown[]> = {};
  let steps  = 0;
  let answer = "";

  for (let turn = 0; turn < MAX_STEPS; turn++) {
    const resp = await callModel(system, messages);
    if (!resp || !resp.content) {
      answer = answer || "I couldn't reach the analysis model right now. Please try again.";
      break;
    }

    const toolUses = resp.content.filter(b => b.type === "tool_use");
    const text     = resp.content.filter(b => b.type === "text").map(b => b.text ?? "").join("\n").trim();
    if (text) answer = text;

    // Model is done reasoning — `answer` holds the narrative.
    if (resp.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Echo the assistant turn (with its tool_use blocks) back into the transcript.
    messages.push({ role: "assistant", content: resp.content });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      steps++;
      const pipe        = String(tu.input?.pipe ?? "");
      const modelParams = (tu.input?.params ?? {}) as Record<string, unknown>;

      let resultText: string;
      if (!isCatalogPipe(pipe)) {
        resultText = `Error: '${pipe}' is not an allowed pipe. Choose one from the catalog.`;
      } else {
        const params = buildParams(modelParams, opts.orgId, opts.scope);
        try {
          const rows   = await queryTinybird(pipe, params);
          const capped = rows.slice(0, MAX_ROWS_BACK);
          data[pipe]   = capped;
          provenance.push({ pipe, params: stripInternal(params), rows: rows.length });
          resultText = JSON.stringify(capped);
        } catch (e) {
          provenance.push({ pipe, params: stripInternal(params), rows: 0 });
          resultText = `Error querying ${pipe}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!answer) answer = "I wasn't able to find an answer with the available metrics.";
  return { answer, provenance, data, steps };
}
