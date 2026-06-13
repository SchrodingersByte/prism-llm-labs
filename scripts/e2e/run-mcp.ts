/**
 * MCP SDK E2E test — inserts mcp_tool_events covering:
 * Agents/MCP tools dashboard, agent loop detection, downstream resource.
 *
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/run-mcp.ts
 */

require("dotenv").config({ path: ".env.e2e" });
delete process.env["PRISM_GATEWAY_URL"];

import * as fs from "fs";
import { PrismMCP } from "@prism-llm-labs/mcp-sdk";

interface Seed {
  projectId:          string;
  analyticsRawKey:    string;
  analyticsSessionId?: string;
}

async function run() {
  if (!fs.existsSync(".e2e-seed.json")) {
    console.error("[mcp] .e2e-seed.json not found — run seed.ts first");
    process.exit(1);
  }

  const seed: Seed = JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));
  const { projectId, analyticsRawKey } = seed;
  // Reuse the session from analytics mode so LLM + MCP events share a session_id
  const sessionId = seed.analyticsSessionId ?? `e2e-mcp-${Date.now()}`;

  const mcp = new PrismMCP({
    prismKey:    analyticsRawKey,
    project:     projectId,
    serverName:  "e2e-test-server",
    sessionId,
    environment: "development",
  });

  // ── Test A: Normal tool call with downstream resource ─────────────────────────
  console.log("[mcp] A: normal tool call with downstream resource");
  await mcp.wrapToolCall("search_docs", async (ctx) => {
    ctx.setDownstreamResource("pinecone:e2e-test-index");
    ctx.reportActualCost(0.0001);
    return { results: ["doc-1", "doc-2"] };
  });

  // ── Test B: Second tool with different downstream resource ────────────────────
  console.log("[mcp] B: database lookup tool");
  await mcp.wrapToolCall("lookup_record", async (ctx) => {
    ctx.setDownstreamResource("qdrant:e2e-collection");
    return { record: { id: "abc123", name: "test" } };
  });

  // ── Test C: Error tool call → MCP error rate metric ──────────────────────────
  console.log("[mcp] C: error tool call");
  await mcp.wrapToolCall("failing_tool", async () => {
    throw new Error("Simulated tool failure for e2e testing");
  }).catch(() => {
    // Error is expected — the SDK records it and we swallow it here
  });

  // ── Test D: Repeated calls for same tool → agent_loop_detection ───────────────
  // Loop detection triggers when the same tool is called 10+ times in one session
  console.log("[mcp] D: 12 repeated calls (triggers loop detection pipe)");
  for (let i = 0; i < 12; i++) {
    await mcp.wrapToolCall("repeated_search", async () => ({
      result: `item-${i}`,
    }));
  }

  // ── Test E: Resource read ──────────────────────────────────────────────────────
  console.log("[mcp] E: resource read");
  await mcp.wrapResourceRead("file:///e2e/docs/readme.md", async (ctx) => {
    void ctx; // ctx available but not needed for simple resources
    return { content: "E2E test document content" };
  });

  // ── Test F: End session with value → outcome event ───────────────────────────
  console.log("[mcp] F: end session with outcome");
  await mcp.endSession({ success: true, valueUsd: 5.00 });

  console.log("[mcp] All tests complete — events sent to Tinybird via /api/mcp/ingest");
  console.log(`[mcp] session_id: ${sessionId}`);
}

run().catch((err) => {
  console.error("[mcp] Fatal:", err);
  process.exit(1);
});
