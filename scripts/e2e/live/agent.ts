/**
 * Prism live test agent — exercises all features through the real pipeline.
 *
 * Five scenarios run in sequence:
 *   1. Normal support flow   — search docs, look up customer, resolve ticket
 *   2. PII detection         — prompt with email + phone (triggers incident log)
 *   3. Agent loop            — unsolvable task → repeated escalations → loop detection
 *   4. Branch simulation     — re-run with GITHUB_REF_NAME=feature/test-routing
 *   5. Soft-cap downgrade    — x-prism-soft-cap-model header
 *
 * All LLM calls go through the Prism gateway. Tool calls are tracked via the
 * MCP server child process. Both share a PrismSession ID.
 *
 * Usage:
 *   source .env.e2e
 *   PRISM_GATEWAY_URL=http://localhost:3000 \
 *   ts-node --project scripts/e2e/tsconfig.json scripts/e2e/live/agent.ts
 */

require("dotenv").config({ path: ".env.e2e" });

import { Client }               from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as path                from "path";
import * as crypto              from "crypto";

const APP_URL          = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PRISM_API_KEY    = process.env.PRISM_API_KEY!;
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY!;
const GATEWAY_URL      = process.env.PRISM_GATEWAY_URL
  ? process.env.PRISM_GATEWAY_URL.replace(/\/$/, "")
  : APP_URL;

// Find the Developer Tools project ID from the demo seed context
// (set PRISM_PROJECT_ID in .env.e2e, or we look it up below)
const PRISM_PROJECT_ID = process.env.PRISM_PROJECT_ID ?? "";

if (!PRISM_API_KEY) {
  console.error("[agent] PRISM_API_KEY not set");
  process.exit(1);
}

// ── OpenAI gateway client (raw fetch — avoids SDK import timing issues) ──────
interface Message { role: "system" | "user" | "assistant" | "tool"; content: string; tool_call_id?: string; name?: string }
interface ToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }

async function chatCompletion(
  messages:    Message[],
  tools:       ToolDef[],
  extraHeaders: Record<string, string> = {},
  model = "gpt-4o-mini",
): Promise<{ content: string | null; toolCalls: ToolCall[] }> {
  const res = await fetch(`${GATEWAY_URL}/api/gateway/openai/v1/chat/completions`, {
    method:  "POST",
    headers: {
      "Authorization":    `Bearer ${PRISM_API_KEY}`,
      "Content-Type":     "application/json",
      "x-prism-feature":  "customer-support",
      "x-prism-action":   "ticket-resolution",
      "x-prism-cost-center": "GL-DEV-03",
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages,
      tools:       tools.length ? tools : undefined,
      tool_choice: tools.length ? "auto" : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gateway error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as {
    choices: Array<{
      message: { content?: string; tool_calls?: ToolCall[] }
    }>
  };
  const msg = data.choices[0]?.message ?? {};
  return { content: msg.content ?? null, toolCalls: msg.tool_calls ?? [] };
}

// ── MCP client helpers ────────────────────────────────────────────────────────
function mcpToolsToOpenAI(mcpTools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>): ToolDef[] {
  return mcpTools.map((t) => ({
    type:     "function",
    function: { name: t.name, description: t.description ?? t.name, parameters: t.inputSchema },
  }));
}

// ── Agentic loop ──────────────────────────────────────────────────────────────
async function runAgentLoop(
  mcpClient:    Client,
  systemPrompt: string,
  userMessage:  string,
  sessionId:    string,
  extraHeaders: Record<string, string> = {},
  maxTurns = 10,
): Promise<string> {
  const { tools: mcpTools } = await mcpClient.listTools();
  const tools = mcpToolsToOpenAI(mcpTools as Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>);

  const messages: Message[] = [
    { role: "system",  content: systemPrompt },
    { role: "user",    content: userMessage  },
  ];

  const sessionHeaders = {
    "x-prism-tags": JSON.stringify({ session_id: sessionId }),
    ...extraHeaders,
  };

  for (let turn = 0; turn < maxTurns; turn++) {
    const { content, toolCalls } = await chatCompletion(messages, tools, sessionHeaders);

    if (toolCalls.length === 0) {
      // Final answer — no more tool calls
      return content ?? "(no response)";
    }

    // Add assistant message with tool calls
    messages.push({ role: "assistant", content: content ?? "", ...{ tool_calls: toolCalls } } as unknown as Message);

    // Execute each tool call via MCP
    for (const tc of toolCalls) {
      let toolResult: string;
      try {
        const args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        const result = await mcpClient.callTool({ name: tc.function.name, arguments: args });
        const text = (result.content as Array<{ text?: string }>)[0]?.text ?? JSON.stringify(result.content);
        toolResult = text;
        console.log(`  [tool] ${tc.function.name}(${JSON.stringify(args).slice(0, 60)}) → ${text.slice(0, 80)}`);
      } catch (err) {
        toolResult = `Error: ${(err as Error).message}`;
        console.log(`  [tool] ${tc.function.name} → ERROR: ${toolResult}`);
      }

      messages.push({
        role:        "tool",
        content:     toolResult,
        tool_call_id: tc.id,
        name:        tc.function.name,
      });
    }
  }

  return "(max turns reached)";
}

// ── Scenario runner ───────────────────────────────────────────────────────────
async function runScenario(
  label:        string,
  mcpClient:    Client,
  system:       string,
  user:         string,
  sessionId:    string,
  extraHeaders: Record<string, string> = {},
  maxTurns = 10,
) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Scenario: ${label}`);
  console.log(`Session:  ${sessionId}`);
  console.log("=".repeat(60));

  try {
    const answer = await runAgentLoop(mcpClient, system, user, sessionId, extraHeaders, maxTurns);
    console.log(`\nAgent answer:\n${answer}`);
  } catch (err) {
    console.log(`\nAgent stopped: ${(err as Error).message}`);
  }
}

// ── MCP client factory ────────────────────────────────────────────────────────
async function spawnMcpClient(sessionId: string): Promise<Client> {
  const tsNodeBin = path.join(__dirname, "..", "node_modules", ".bin", "ts-node");
  const serverScript = path.join(__dirname, "mcp-server.ts");
  const tsconfigPath = path.join(__dirname, "..", "tsconfig.json");

  const transport = new StdioClientTransport({
    command: tsNodeBin,
    args:    ["--project", tsconfigPath, serverScript],
    env:     {
      ...process.env as Record<string, string>,
      PRISM_SESSION_ID:  sessionId,
      PRISM_PROJECT_ID:  PRISM_PROJECT_ID,
      PRISM_GATEWAY_URL: GATEWAY_URL,
    },
  });

  const client = new Client({ name: "prism-test-agent", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`[agent] Gateway: ${GATEWAY_URL}`);
  console.log(`[agent] Prism key: ${PRISM_API_KEY.slice(0, 16)}...`);

  const systemPrompt = `You are a helpful customer support agent. Use the available tools to resolve customer issues.
Always search for relevant documentation before answering. Look up customer records when a customer ID is provided.
If you cannot resolve an issue after 3 attempts, escalate the ticket.`;

  // ── Scenario 1: Normal support flow ──────────────────────────────────────
  const sess1 = crypto.randomUUID();
  const mcp1  = await spawnMcpClient(sess1);
  await runScenario(
    "1. Normal support flow",
    mcp1,
    systemPrompt,
    "Hi, I'm customer C-001. I forgot my password and can't log in. I also want to understand when I'll be billed next month.",
    sess1,
  );
  await mcp1.close();

  // ── Scenario 2: PII detection ─────────────────────────────────────────────
  const sess2 = crypto.randomUUID();
  const mcp2  = await spawnMcpClient(sess2);
  await runScenario(
    "2. PII detection (email + phone in prompt)",
    mcp2,
    systemPrompt,
    "My customer's name is Jane Doe, email jane.doe@privatemail.com, phone 555-867-5309. Her SSN is 123-45-6789. Please look up customer C-002 and send her a notification about her billing.",
    sess2,
    {},
    6,
  );
  await mcp2.close();

  // ── Scenario 3: Agent loop (unsolvable escalation) ────────────────────────
  const sess3 = crypto.randomUUID();
  const mcp3  = await spawnMcpClient(sess3);
  await runScenario(
    "3. Agent loop — repeated escalations (triggers loop detection)",
    mcp3,
    `You are a support agent. You MUST escalate ticket T-9999 repeatedly until you get confirmation that it was escalated.
If escalation fails, try again immediately with a different reason. Never give up — keep escalating.`,
    "Ticket T-9999 MUST be escalated to the CEO. This is critical. Do not stop until confirmed.",
    sess3,
    {},
    20,
  );
  await mcp3.close();

  // ── Scenario 4: Branch attribution (feature branch) ─────────────────────
  const sess4 = crypto.randomUUID();
  // Simulate running from a feature branch
  process.env["GITHUB_REF_NAME"] = "feature/test-routing";
  const mcp4 = await spawnMcpClient(sess4);
  await runScenario(
    "4. Branch attribution (feature/test-routing branch)",
    mcp4,
    systemPrompt,
    "Search for information about API rate limits and export it for our docs team.",
    sess4,
    { "x-prism-branch": "feature/test-routing" },
  );
  await mcp4.close();
  delete process.env["GITHUB_REF_NAME"];

  // ── Scenario 5: Soft-cap model downgrade ──────────────────────────────────
  const sess5 = crypto.randomUUID();
  const mcp5  = await spawnMcpClient(sess5);
  await runScenario(
    "5. Soft-cap model downgrade (x-prism-soft-cap-model header)",
    mcp5,
    systemPrompt,
    "Summarise the key points from our webhook configuration guide for a developer.",
    sess5,
    {
      "x-prism-soft-cap-model": "gpt-4o-mini",   // downgrade if cost threshold hit
      "x-prism-soft-cap-pct":   "80",
    },
  );
  await mcp5.close();

  console.log("\n" + "=".repeat(60));
  console.log("All scenarios complete!");
  console.log("=".repeat(60));
  console.log("\nCheck the dashboard:");
  console.log("  /dashboard                 — new requests spike");
  console.log("  /dashboard/agents          — support-tools server + loop detection");
  console.log("  /dashboard/sessions        — 5 sessions with MCP calls");
  console.log("  /dashboard/unit-economics  — customer-support feature");
  console.log("  /settings/compliance       — PII incidents from scenario 2");
  console.log("  /dashboard/projects        — branch: feature/test-routing");
}

run().catch((err) => {
  console.error("[agent] Fatal:", err);
  process.exit(1);
});
