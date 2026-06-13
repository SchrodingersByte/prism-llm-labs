/**
 * PrismSession — shared session context for multi-server agent runs.
 *
 * Creates a single session_id that is automatically threaded through:
 *   - Multiple PrismMCP server instances (files, database, search, etc.)
 *   - LLM SDK clients (OpenAI, Anthropic) via toLLMOptions()
 *
 * This ensures every LLM call and every tool/resource/prompt call in one
 * agent run appears under the same session in /dashboard/sessions/[id].
 *
 * Usage:
 *   const session = new PrismSession({
 *     prismKey: process.env.PRISM_API_KEY,
 *     project:  "customer-support",
 *     sessionBudgetUsd: 2.00,   // hard cap for the whole agent run
 *   });
 *
 *   // MCP servers — all share session.sessionId automatically
 *   const filesMcp  = session.createServer({ serverName: "files" });
 *   const dbMcp     = session.createServer({ serverName: "database" });
 *   const searchMcp = session.createServer({ serverName: "search" });
 *
 *   // LLM SDK client — same session_id
 *   import { OpenAI } from "@prism-llm-labs/sdk";
 *   const openai = new OpenAI(session.toLLMOptions());
 */

import { PrismMCP }         from "./prism-mcp";
import type { PrismMcpOptions } from "./types";

export interface PrismSessionOptions {
  /** Prism API key — or set PRISM_API_KEY env var */
  prismKey?:               string;
  /** Project ID for cost attribution */
  project?:                string;
  /** Team attribution tag */
  team?:                   string;
  /** "production" | "staging" | "development" */
  environment?:            string;
  /**
   * Explicit session ID. Auto-generated UUID if omitted.
   * Pass an explicit ID when the session ID is determined by an external
   * orchestrator (e.g. a LangGraph run ID, a task queue job ID).
   */
  sessionId?:              string;
  /**
   * Explicit trace ID to link all spans in this session to a single trace.
   * Auto-generated UUID if omitted. Forwarded to LLM SDK clients via
   * toLLMOptions() so that LLM events and tool events share the same trace_id.
   */
  traceId?:                string;
  /** Hard cost cap across ALL servers in this session */
  sessionBudgetUsd?:       number;
  /** Hard tool-call cap across ALL servers in this session */
  maxToolCallsPerSession?: number;
  /** Opt-in I/O capture for all servers created from this session */
  captureInputs?:          boolean;
  captureOutputs?:         boolean;
  redactKeys?:             string[];
  /** Override ingest URL (for testing) */
  ingestUrl?:              string;
}

/** Options for individual servers within a session */
export type PerServerOptions = Omit<
  PrismMcpOptions,
  "prismKey" | "project" | "team" | "environment" | "sessionId" |
  "sessionBudgetUsd" | "maxToolCallsPerSession" | "captureInputs" |
  "captureOutputs" | "redactKeys" | "ingestUrl"
>;

export class PrismSession {
  readonly sessionId: string;
  readonly traceId:   string;

  private readonly key:         string;
  private readonly project:     string;
  private readonly team:        string;
  private readonly environment: string;
  private readonly sharedOpts:  PrismSessionOptions;

  constructor(options: PrismSessionOptions = {}) {
    this.key         = options.prismKey   ?? process.env["PRISM_API_KEY"]     ?? "";
    this.project     = options.project    ?? process.env["PRISM_PROJECT"]     ?? "";
    this.team        = options.team       ?? process.env["PRISM_TEAM"]        ?? "";
    this.environment = options.environment ?? process.env["PRISM_ENVIRONMENT"] ?? "production";
    this.sessionId   = options.sessionId  ?? crypto.randomUUID();
    this.traceId     = options.traceId    ?? crypto.randomUUID();
    this.sharedOpts  = options;

    if (!this.key) {
      console.warn("[prism-mcp] PrismSession: PRISM_API_KEY not set — observability disabled.");
    }
  }

  /**
   * Create a PrismMCP instance bound to this session.
   * All servers created from the same session share the same session_id.
   */
  createServer(perServer: PerServerOptions = {}): PrismMCP {
    return new PrismMCP({
      prismKey:               this.key,
      project:                this.project,
      team:                   this.team,
      environment:            this.environment,
      sessionId:              this.sessionId,
      sessionBudgetUsd:       this.sharedOpts.sessionBudgetUsd,
      maxToolCallsPerSession: this.sharedOpts.maxToolCallsPerSession,
      captureInputs:          this.sharedOpts.captureInputs,
      captureOutputs:         this.sharedOpts.captureOutputs,
      redactKeys:             this.sharedOpts.redactKeys,
      ingestUrl:              this.sharedOpts.ingestUrl,
      // per-server overrides
      serverName:             perServer.serverName,
    });
  }

  /**
   * Returns options to pass to the Prism LLM SDK clients (@prism-llm-labs/sdk)
   * so that LLM completions share this session's session_id.
   *
   *   import { OpenAI } from "@prism-llm-labs/sdk";
   *   const openai = new OpenAI(session.toLLMOptions());
   */
  toLLMOptions(): {
    prismKey:    string;
    project:     string;
    team:        string;
    environment: string;
    sessionId:   string;
    traceId:     string;
  } {
    return {
      prismKey:    this.key,
      project:     this.project,
      team:        this.team,
      environment: this.environment,
      sessionId:   this.sessionId,
      traceId:     this.traceId,
    };
  }
}
