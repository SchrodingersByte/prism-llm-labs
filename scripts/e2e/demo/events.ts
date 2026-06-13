/**
 * Phase 2 — Historical event generation via direct Tinybird API.
 *
 * Sends ~600 LLM events, ~250 MCP events, ~60 outcome events
 * spanning 30 days to the org's Tinybird datasources.
 *
 * All timestamps formatted as "YYYY-MM-DD HH:MM:SS.mmm" (no T/Z).
 * Event IDs are deterministic sha256 hashes for idempotency.
 */

import { createHash } from "crypto";
import type { DemoContext } from "./infra";

const TINYBIRD_API_URL   = (process.env.TINYBIRD_API_URL ?? "https://api.tinybird.co").replace(/\/$/, "");
const TINYBIRD_ADMIN_TOKEN = process.env.TINYBIRD_ADMIN_TOKEN!;

// ── Pricing (per 1M tokens, matching apps/web/lib/pricing/table.ts) ───────────
const MODEL_PRICE: Record<string, { input: number; output: number; provider: string }> = {
  "gpt-4o":                     { provider: "openai",    input: 2.50,  output: 10.00 },
  "gpt-4o-mini":                { provider: "openai",    input: 0.15,  output: 0.60  },
  "claude-3-5-haiku-20241022":  { provider: "anthropic", input: 0.80,  output: 4.00  },
  "claude-3-5-sonnet-20241022": { provider: "anthropic", input: 3.00,  output: 15.00 },
  "gemini-2.0-flash":           { provider: "google",    input: 0.10,  output: 0.40  },
};

function cost(model: string, inputTok: number, outputTok: number, cachedTok = 0): number {
  const p = MODEL_PRICE[model];
  if (!p) return 0;
  const inp = ((inputTok - cachedTok) * p.input + cachedTok * p.input * 0.5) / 1_000_000;
  const out = outputTok * p.output / 1_000_000;
  return Math.round((inp + out) * 1_000_000) / 1_000_000;
}

// Seeded pseudo-random for reproducibility
function sr(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}
function randInt(min: number, max: number, seed: number): number {
  return min + Math.floor(sr(seed) * (max - min + 1));
}

function deterministicUuid(key: string): string {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

function tbTs(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 23);
}

function dateAt(daysBack: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysBack);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

async function tinybirdNdjson(datasource: string, rows: Record<string, unknown>[]) {
  const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
  const res = await fetch(`${TINYBIRD_API_URL}/v0/events?name=${datasource}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${TINYBIRD_ADMIN_TOKEN}`, "Content-Type": "application/ndjson" },
    body:    ndjson,
  });
  const body = await res.json() as { successful_rows?: number; quarantined_rows?: number; error?: string };
  if (!res.ok || (body.quarantined_rows ?? 0) > 0) {
    console.warn(`[events] Tinybird ${datasource} warn:`, JSON.stringify(body));
  }
  return body.successful_rows ?? 0;
}

async function sendBatched(datasource: string, rows: Record<string, unknown>[], batchSize = 50) {
  let sent = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    sent += await tinybirdNdjson(datasource, rows.slice(i, i + batchSize));
  }
  return sent;
}

async function deleteSingleDatasource(ds: string, orgId: string): Promise<void> {
  const params = new URLSearchParams({ delete_condition: `org_id = '${orgId}'` });
  // Retry up to 5 times with 3s gap — Tinybird limits to 1 concurrent delete job
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${TINYBIRD_API_URL}/v0/datasources/${encodeURIComponent(ds)}/delete`, {
      method:  "POST",
      headers: { Authorization: `Bearer ${TINYBIRD_ADMIN_TOKEN}`, "Content-Type": "application/x-www-form-urlencoded" },
      body:    params.toString(),
    });
    if (res.ok || res.status === 404) {
      console.log(`[events] cleared ${ds} for org`);
      return;
    }
    const text = await res.text();
    if (res.status === 429) {
      // Another delete job is still running — wait 4s and retry
      await new Promise((r) => setTimeout(r, 4000));
    } else {
      console.warn(`[events] delete ${ds} warn: ${res.status} ${text}`);
      return;
    }
  }
  console.warn(`[events] delete ${ds}: gave up after retries`);
}

async function deleteOrgEvents(orgId: string) {
  for (const ds of ["llm_events_v2", "mcp_tool_events", "outcome_events"]) {
    await deleteSingleDatasource(ds, orgId);
    // Brief pause so the delete job starts processing before the next request
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ── LLM event scenarios ───────────────────────────────────────────────────────
interface Scenario {
  id:          string;
  feature?:    string;
  action?:     string;
  model:       string;
  projectId:   string;    // injected at call time
  projectName: string;
  teamId:      string;    // injected at call time
  teamName:    string;
  costCenter:  string;
  branch:      string;
  developer:   string;
  keyId:       string;    // injected at call time
  inputRange:  [number, number];
  outputRange: [number, number];
  cacheProb:   number;    // probability of cached tokens (0-1)
  errorProb:   number;    // probability of error (0-1)
  weight:      number;    // relative frequency
  environment: string;
}

// Context will be filled by generateLlmEvents
let _ctx: DemoContext;

function getScenarios(): Scenario[] {
  const { projects, teams, apiKeys } = _ctx;
  return [
    {
      id: "support-triage", feature: "customer-support", action: "ticket-triage",
      model: "gpt-4o-mini", projectId: projects.customerPlatform, projectName: "Customer Platform",
      teamId: teams.aiEng, teamName: "AI Engineering", costCenter: "GL-ENG-01",
      branch: "main", developer: "alice@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [80, 600], outputRange: [20, 200], cacheProb: 0.3, errorProb: 0.04, weight: 5, environment: "production",
    },
    {
      id: "support-response", feature: "customer-support", action: "ticket-response",
      model: "gpt-4o", projectId: projects.customerPlatform, projectName: "Customer Platform",
      teamId: teams.aiEng, teamName: "AI Engineering", costCenter: "GL-ENG-01",
      branch: "main", developer: "alice@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [200, 1500], outputRange: [100, 600], cacheProb: 0.25, errorProb: 0.03, weight: 4, environment: "production",
    },
    {
      id: "support-escalation", feature: "customer-support", action: "escalation-check",
      model: "claude-3-5-haiku-20241022", projectId: projects.customerPlatform, projectName: "Customer Platform",
      teamId: teams.aiEng, teamName: "AI Engineering", costCenter: "GL-ENG-01",
      branch: "feature/support-v3", developer: "alice@company.com", keyId: apiKeys.prodAnthropic.id,
      inputRange: [100, 800], outputRange: [30, 300], cacheProb: 0.2, errorProb: 0.05, weight: 2, environment: "production",
    },
    {
      id: "doc-summary", feature: "document-analysis", action: "pdf-summary",
      model: "gpt-4o-mini", projectId: projects.dataAnalytics, projectName: "Data Analytics",
      teamId: teams.dataSci, teamName: "Data Science", costCenter: "GL-DATA-02",
      branch: "main", developer: "bob@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [300, 2000], outputRange: [100, 500], cacheProb: 0.15, errorProb: 0.02, weight: 4, environment: "production",
    },
    {
      id: "doc-extract", feature: "document-analysis", action: "data-extraction",
      model: "claude-3-5-sonnet-20241022", projectId: projects.dataAnalytics, projectName: "Data Analytics",
      teamId: teams.dataSci, teamName: "Data Science", costCenter: "GL-DATA-02",
      branch: "feature/extractor-v2", developer: "bob@company.com", keyId: apiKeys.prodAnthropic.id,
      inputRange: [400, 3000], outputRange: [100, 800], cacheProb: 0.35, errorProb: 0.03, weight: 3, environment: "production",
    },
    {
      id: "code-security", feature: "code-review", action: "security-scan",
      model: "gpt-4o", projectId: projects.developerTools, projectName: "Developer Tools",
      teamId: teams.devEx, teamName: "Developer Experience", costCenter: "GL-DEV-03",
      branch: "main", developer: "priya@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [200, 2000], outputRange: [100, 600], cacheProb: 0.4, errorProb: 0.03, weight: 3, environment: "production",
    },
    {
      id: "code-style", feature: "code-review", action: "style-check",
      model: "gpt-4o-mini", projectId: projects.developerTools, projectName: "Developer Tools",
      teamId: teams.devEx, teamName: "Developer Experience", costCenter: "GL-DEV-03",
      branch: "fix/linter-rules", developer: "priya@company.com", keyId: apiKeys.devUnrestricted.id,
      inputRange: [100, 800], outputRange: [30, 200], cacheProb: 0.5, errorProb: 0.02, weight: 3, environment: "development",
    },
    {
      id: "recs", feature: "recommendations", action: "item-ranking",
      model: "gemini-2.0-flash", projectId: projects.customerPlatform, projectName: "Customer Platform",
      teamId: teams.aiEng, teamName: "AI Engineering", costCenter: "GL-ENG-01",
      branch: "release/v2.1", developer: "alice@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [100, 1200], outputRange: [40, 400], cacheProb: 0.45, errorProb: 0.02, weight: 4, environment: "production",
    },
    {
      id: "search", feature: "search", action: "semantic-search",
      model: "gpt-4o-mini", projectId: projects.dataAnalytics, projectName: "Data Analytics",
      teamId: teams.dataSci, teamName: "Data Science", costCenter: "GL-DATA-02",
      branch: "main", developer: "bob@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [50, 400], outputRange: [20, 150], cacheProb: 0.6, errorProb: 0.01, weight: 5, environment: "production",
    },
    {
      id: "ml-research",
      model: "claude-3-5-sonnet-20241022", projectId: projects.mlResearch, projectName: "ML Research",
      teamId: teams.dataSci, teamName: "Data Science", costCenter: "GL-ML-04",
      branch: "experiment/llm-eval", developer: "bob@company.com", keyId: apiKeys.devUnrestricted.id,
      inputRange: [500, 4000], outputRange: [200, 1200], cacheProb: 0.1, errorProb: 0.08, weight: 3, environment: "development",
    },
    {
      id: "image-analysis", feature: "image-analysis", action: "ocr",
      model: "gpt-4o", projectId: projects.dataAnalytics, projectName: "Data Analytics",
      teamId: teams.dataSci, teamName: "Data Science", costCenter: "GL-DATA-02",
      branch: "main", developer: "bob@company.com", keyId: apiKeys.prodAll.id,
      inputRange: [200, 1000], outputRange: [50, 300], cacheProb: 0.05, errorProb: 0.04, weight: 2, environment: "production",
    },
    {
      id: "staging-test", feature: "customer-support", action: "ticket-triage",
      model: "gpt-4o-mini", projectId: projects.mlResearch, projectName: "ML Research",
      teamId: teams.aiEng, teamName: "AI Engineering", costCenter: "GL-ML-04",
      branch: "staging", developer: "alice@company.com", keyId: apiKeys.stagingControlled.id,
      inputRange: [80, 400], outputRange: [20, 150], cacheProb: 0.3, errorProb: 0.06, weight: 2, environment: "staging",
    },
  ];
}

// Weighted scenario picker
function pickScenario(scenarios: Scenario[], seed: number): Scenario {
  const total = scenarios.reduce((s, sc) => s + sc.weight, 0);
  let r = sr(seed) * total;
  for (const sc of scenarios) {
    r -= sc.weight;
    if (r <= 0) return sc;
  }
  return scenarios[scenarios.length - 1];
}

export async function clearOrgEvents(orgId: string): Promise<void> {
  console.log("[events] Clearing existing Tinybird events for org...");
  await deleteOrgEvents(orgId);
}

export async function generateLlmEvents(ctx: DemoContext): Promise<void> {
  _ctx = ctx;
  const { orgId, userId } = ctx;
  const scenarios = getScenarios();

  const llmRows: Record<string, unknown>[] = [];

  // 20 session groups — each session has 3-7 LLM calls
  const sessionDefs = [
    { daysBack: 1,  hour: 9,  count: 5, scenarioId: "support-triage"    },
    { daysBack: 2,  hour: 14, count: 4, scenarioId: "doc-extract"        },
    { daysBack: 3,  hour: 10, count: 6, scenarioId: "code-security"      },
    { daysBack: 4,  hour: 15, count: 3, scenarioId: "recs"               },
    { daysBack: 5,  hour: 11, count: 5, scenarioId: "search"             },
    { daysBack: 6,  hour: 9,  count: 4, scenarioId: "support-response"   },
    { daysBack: 7,  hour: 16, count: 7, scenarioId: "ml-research"        },
    { daysBack: 8,  hour: 10, count: 3, scenarioId: "doc-summary"        },
    { daysBack: 9,  hour: 13, count: 5, scenarioId: "image-analysis"     },
    { daysBack: 10, hour: 9,  count: 4, scenarioId: "support-escalation" },
    { daysBack: 12, hour: 11, count: 6, scenarioId: "code-style"         },
    { daysBack: 13, hour: 14, count: 3, scenarioId: "staging-test"       },
    { daysBack: 14, hour: 10, count: 5, scenarioId: "support-triage"     },
    { daysBack: 15, hour: 15, count: 4, scenarioId: "doc-extract"        },
    { daysBack: 17, hour: 9,  count: 6, scenarioId: "code-security"      },
    { daysBack: 18, hour: 13, count: 3, scenarioId: "recs"               },
    { daysBack: 20, hour: 10, count: 5, scenarioId: "search"             },
    { daysBack: 22, hour: 14, count: 4, scenarioId: "ml-research"        },
    { daysBack: 25, hour: 11, count: 5, scenarioId: "support-response"   },
    { daysBack: 28, hour: 9,  count: 3, scenarioId: "image-analysis"     },
  ];

  for (const sess of sessionDefs) {
    const sessionId = deterministicUuid(`session-${sess.daysBack}-${sess.scenarioId}`);
    const sc = scenarios.find((s) => s.id === sess.scenarioId) ?? scenarios[0];

    for (let i = 0; i < sess.count; i++) {
      const seed = sess.daysBack * 1000 + i * 7;
      const inputTok  = randInt(sc.inputRange[0], sc.inputRange[1], seed);
      const outputTok = randInt(sc.outputRange[0], sc.outputRange[1], seed + 1);
      const hasCached = sr(seed + 2) < sc.cacheProb;
      const cachedTok = hasCached ? Math.floor(inputTok * (0.2 + sr(seed + 3) * 0.5)) : 0;
      const isError   = sr(seed + 4) < sc.errorProb;
      const latency   = randInt(200, isError ? 500 : 3000, seed + 5);

      const ts = dateAt(sess.daysBack, sess.hour, i * 3);
      const eventId = deterministicUuid(`llm-${sess.daysBack}-${sess.scenarioId}-${i}`);

      const tags: Record<string, string> = {
        session_id:    sessionId,
        git_branch:    sc.branch,
        developer:     sc.developer,
        cost_center:   sc.costCenter,
      };
      if (sc.feature)    tags.feature = sc.feature;
      if (sc.action)     tags.action  = sc.action;
      if (sc.teamName)   tags.team    = sc.teamName;

      llmRows.push({
        event_id:       eventId,
        timestamp:      tbTs(ts),
        org_id:         orgId,
        project_id:     sc.projectId,
        project_name:   sc.projectName,
        team_id:        sc.teamId,
        user_id:        userId,
        environment:    sc.environment,
        provider:       MODEL_PRICE[sc.model].provider,
        model:          sc.model,
        input_tokens:   inputTok,
        output_tokens:  outputTok,
        cached_tokens:  cachedTok,
        cost_usd:       isError ? 0 : cost(sc.model, inputTok, outputTok, cachedTok),
        latency_ms:     latency,
        ttft_ms:        Math.floor(latency * 0.2),
        status_code:    isError ? (sr(seed + 6) < 0.5 ? 429 : 500) : 200,
        request_id:     deterministicUuid(`req-${eventId}`).slice(0, 20),
        api_key_id:     sc.keyId,
        ttl_days:       90,
        key_type:       "analytics",
        prism_cache_hit: 0,
        image_tokens:   0,
        audio_tokens:   0,
        text_tokens:    inputTok,
        modalities:     "text",
        tags,
      });
    }
  }

  // Backfill non-session events to reach ~600 total (fill remaining 30 days)
  let eventCounter = 0;
  for (let day = 0; day <= 29; day++) {
    const isWeekend = [0, 6].includes(new Date(Date.now() - day * 86400000).getUTCDay());
    const count = isWeekend ? randInt(3, 8, day * 100) : randInt(12, 22, day * 100 + 1);

    for (let i = 0; i < count; i++) {
      const seed  = day * 10000 + i * 37 + eventCounter;
      const sc    = pickScenario(scenarios, seed);
      const hour  = randInt(8, 21, seed + 10);
      const min   = randInt(0, 59, seed + 11);

      const inputTok  = randInt(sc.inputRange[0], sc.inputRange[1], seed + 20);
      const outputTok = randInt(sc.outputRange[0], sc.outputRange[1], seed + 21);
      const hasCached = sr(seed + 22) < sc.cacheProb;
      const cachedTok = hasCached ? Math.floor(inputTok * (0.2 + sr(seed + 23) * 0.5)) : 0;
      const isError   = sr(seed + 24) < sc.errorProb;
      const latency   = randInt(150, isError ? 500 : 4000, seed + 25);

      const ts      = dateAt(day, hour, min);
      const eventId = deterministicUuid(`llm-fill-${day}-${i}-${sc.id}`);

      const tags: Record<string, string> = {
        git_branch:  sc.branch,
        developer:   sc.developer,
        cost_center: sc.costCenter,
      };
      if (sc.feature) tags.feature = sc.feature;
      if (sc.action)  tags.action  = sc.action;
      if (sc.teamName) tags.team   = sc.teamName;

      llmRows.push({
        event_id:       eventId,
        timestamp:      tbTs(ts),
        org_id:         orgId,
        project_id:     sc.projectId,
        project_name:   sc.projectName,
        team_id:        sc.teamId,
        user_id:        userId,
        environment:    sc.environment,
        provider:       MODEL_PRICE[sc.model].provider,
        model:          sc.model,
        input_tokens:   inputTok,
        output_tokens:  outputTok,
        cached_tokens:  cachedTok,
        cost_usd:       isError ? 0 : cost(sc.model, inputTok, outputTok, cachedTok),
        latency_ms:     latency,
        ttft_ms:        Math.floor(latency * 0.2),
        status_code:    isError ? (sr(seed + 26) < 0.5 ? 429 : 500) : 200,
        request_id:     deterministicUuid(`req-fill-${eventId}`).slice(0, 20),
        api_key_id:     sc.keyId,
        ttl_days:       90,
        key_type:       "analytics",
        prism_cache_hit: 0,
        image_tokens:   0,
        audio_tokens:   0,
        text_tokens:    inputTok,
        modalities:     "text",
        tags,
      });
      eventCounter++;
    }
  }

  console.log(`[events] Sending ${llmRows.length} LLM events to Tinybird...`);
  const llmSent = await sendBatched("llm_events_v2", llmRows);
  console.log(`[events] LLM events sent: ${llmSent}`);
}

export async function generateMcpEvents(ctx: DemoContext): Promise<void> {
  const { orgId, userId, projects, apiKeys } = ctx;
  const mcpRows: Record<string, unknown>[] = [];

  // Regular MCP tool calls across 9 tool types
  const mcpScenarios = [
    { tool: "search_knowledge_base", server: "support-tools",  resource: "pinecone:support-docs", primitive: "tool",     projId: projects.customerPlatform, count: 30, spread: 28 },
    { tool: "send_email",            server: "support-tools",  resource: "",                       primitive: "tool",     projId: projects.customerPlatform, count: 15, spread: 25 },
    { tool: "lookup_customer",       server: "support-tools",  resource: "postgres",               primitive: "tool",     projId: projects.customerPlatform, count: 20, spread: 28 },
    { tool: "extract_pdf_text",      server: "doc-tools",      resource: "",                       primitive: "tool",     projId: projects.dataAnalytics,    count: 18, spread: 20 },
    { tool: "query_database",        server: "doc-tools",      resource: "qdrant:doc-embeddings",  primitive: "tool",     projId: projects.dataAnalytics,    count: 22, spread: 20 },
    { tool: "run_linter",            server: "dev-tools",      resource: "",                       primitive: "tool",     projId: projects.developerTools,   count: 15, spread: 15 },
    { tool: "search_code",           server: "dev-tools",      resource: "",                       primitive: "tool",     projId: projects.developerTools,   count: 12, spread: 15 },
    { tool: "read_file",             server: "dev-tools",      resource: "file:///repo",           primitive: "resource", projId: projects.developerTools,   count: 10, spread: 15 },
    { tool: "get_system_prompt",     server: "dev-tools",      resource: "",                       primitive: "prompt",   projId: projects.developerTools,   count: 8,  spread: 10 },
  ];

  for (const sc of mcpScenarios) {
    for (let i = 0; i < sc.count; i++) {
      const seed    = sc.tool.length * 1000 + i * 41;
      const daysBack = Math.floor(sr(seed) * sc.spread);
      const hour    = randInt(8, 21, seed + 1);
      const ts      = dateAt(daysBack, hour, randInt(0, 59, seed + 2));
      const isError = sr(seed + 3) < 0.05;
      const sessId  = deterministicUuid(`mcp-sess-${sc.tool}-${i}`);
      const eventId = deterministicUuid(`mcp-${sc.tool}-${i}`);
      const latency = randInt(50, isError ? 300 : 1500, seed + 4);
      const costEst = sc.resource.startsWith("pinecone") ? randInt(1, 8, seed + 5) / 1000
                    : sc.resource.startsWith("qdrant") ? randInt(1, 5, seed + 5) / 1000
                    : 0;

      mcpRows.push({
        event_id:             eventId,
        timestamp:            tbTs(ts),
        org_id:               orgId,
        session_id:           sessId,
        tool_name:            sc.tool,
        mcp_server_name:      sc.server,
        primitive_type:       sc.primitive,
        downstream_resource:  sc.resource || "",
        project_id:           sc.projId,
        team_id:              "",
        user_id:              userId,
        environment:          "production",
        execution_latency_ms: latency,
        tool_cost_usd:        costEst,
        status:               isError ? "error" : "success",
        error_message:        isError ? `Tool execution failed: ${sc.tool} timeout` : "",
        llm_request_id:       "",
        cost_status:          "estimated",
        tags:                 {},
      });
    }
  }

  // Agent loop sessions — 3 sessions, 12+ repeated tool calls each
  const loopTools = ["search_knowledge_base", "query_database", "lookup_customer"];
  for (let loopIdx = 0; loopIdx < 3; loopIdx++) {
    const toolName = loopTools[loopIdx];
    const loopSessId = deterministicUuid(`loop-session-${loopIdx}`);
    const daysBack = [3, 8, 15][loopIdx];
    const hour = 14;

    for (let call = 0; call < 13 + loopIdx * 2; call++) {
      const ts      = dateAt(daysBack, hour, call * 2);
      const eventId = deterministicUuid(`loop-${loopIdx}-call-${call}`);
      const seed    = loopIdx * 10000 + call * 31;
      const isErr   = call > 10 && sr(seed) < 0.3;

      mcpRows.push({
        event_id:             eventId,
        timestamp:            tbTs(ts),
        org_id:               orgId,
        session_id:           loopSessId,
        tool_name:            toolName,
        mcp_server_name:      "support-tools",
        primitive_type:       "tool",
        downstream_resource:  toolName === "search_knowledge_base" ? "pinecone:support-docs" : "",
        project_id:           projects.customerPlatform,
        team_id:              "",
        user_id:              userId,
        environment:          "production",
        execution_latency_ms: randInt(200, 800, seed),
        tool_cost_usd:        0.003,
        status:               isErr ? "error" : "success",
        error_message:        isErr ? "No new results found — possible loop" : "",
        llm_request_id:       "",
        cost_status:          "estimated",
        tags:                 {},
      });
    }
    console.log(`[events] Agent loop session ${loopIdx + 1}: ${13 + loopIdx * 2} calls to ${toolName}`);
  }

  console.log(`[events] Sending ${mcpRows.length} MCP events to Tinybird...`);
  const mcpSent = await sendBatched("mcp_tool_events", mcpRows);
  console.log(`[events] MCP events sent: ${mcpSent}`);
}

export async function generateOutcomeEvents(ctx: DemoContext): Promise<void> {
  const { orgId, projects, apiKeys } = ctx;
  const rows: Record<string, unknown>[] = [];

  const outcomeScenarios = [
    { feature: "customer-support", action: "ticket-resolved",      projId: projects.customerPlatform, count: 20, successRate: 0.85, valMin: 2,    valMax: 10   },
    { feature: "document-analysis", action: "doc-processed",       projId: projects.dataAnalytics,    count: 18, successRate: 0.95, valMin: 1,    valMax: 5    },
    { feature: "code-review",      action: "review-completed",      projId: projects.developerTools,   count: 12, successRate: 0.90, valMin: 5,    valMax: 15   },
    { feature: "recommendations",  action: "recommendation-served", projId: projects.customerPlatform, count: 10, successRate: 1.00, valMin: 0.5,  valMax: 2    },
  ];

  for (const sc of outcomeScenarios) {
    for (let i = 0; i < sc.count; i++) {
      const seed     = sc.feature.length * 5000 + i * 53;
      const daysBack = Math.floor(sr(seed) * 28);
      const hour     = randInt(8, 21, seed + 1);
      const ts       = dateAt(daysBack, hour, randInt(0, 59, seed + 2));
      const success  = sr(seed + 3) < sc.successRate;
      const value    = success ? sc.valMin + sr(seed + 4) * (sc.valMax - sc.valMin) : 0;
      const eventId  = deterministicUuid(`outcome-${sc.feature}-${i}`);

      rows.push({
        event_id:    eventId,
        occurred_at: tbTs(ts),
        org_id:      orgId,
        feature_tag: sc.feature,
        action_tag:  sc.action,
        session_id:  "",
        success:     success ? 1 : 0,
        value_usd:   Math.round(value * 100) / 100,
      });
    }
  }

  console.log(`[events] Sending ${rows.length} outcome events to Tinybird...`);
  const sent = await sendBatched("outcome_events", rows);
  console.log(`[events] Outcome events sent: ${sent}`);
}
