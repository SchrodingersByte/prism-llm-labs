/**
 * Prism test MCP server — runs via stdio.
 *
 * Instruments 4 tools with @prism-llm-labs/mcp-sdk:
 *   search_documents   — real Pinecone query (embeds via OpenAI, searches index)
 *   lookup_customer    — simulated DB lookup
 *   send_notification  — simulated email/SMS delivery
 *   escalate_ticket    — simulated escalation (used to trigger loop detection)
 *
 * Spawned as a child process by agent.ts. Reads session context from env:
 *   PRISM_SESSION_ID   — shared session_id from the agent
 *   PRISM_API_KEY      — Prism API key
 *   PRISM_PROJECT_ID   — project ID for attribution
 *   PRISM_GATEWAY_URL  — Prism gateway base URL (enables gateway tracking)
 *   OPENAI_API_KEY     — OpenAI key (fallback if gateway unavailable)
 *   PINECONE_API_KEY   — Pinecone API key
 *   PINECONE_INDEX     — Pinecone index name (default: prism-test-docs)
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PrismMCP }   from "@prism-llm-labs/mcp-sdk";
import { Pinecone }   from "@pinecone-database/pinecone";

require("dotenv").config({ path: ".env.e2e" });

const PRISM_SESSION_ID = process.env.PRISM_SESSION_ID ?? "";
const PRISM_API_KEY    = process.env.PRISM_API_KEY    ?? "";
const PRISM_PROJECT_ID = process.env.PRISM_PROJECT_ID ?? "";
const GATEWAY_URL      = (process.env.PRISM_GATEWAY_URL ?? "").replace(/\/$/, "");
const OPENAI_API_KEY   = process.env.OPENAI_API_KEY   ?? "";
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? "";
const PINECONE_INDEX   = process.env.PINECONE_INDEX   ?? "prism-test-docs";

// ── Prism instrumentation ─────────────────────────────────────────────────────
const prism = new PrismMCP({
  prismKey:               PRISM_API_KEY,
  serverName:             "support-tools",
  project:                PRISM_PROJECT_ID,
  environment:            "development",
  sessionId:              PRISM_SESSION_ID || undefined,
  maxToolCallsPerSession: 20,
  sessionBudgetUsd:       2.00,
  captureInputs:          true,
  captureOutputs:         true,
});

// ── Embedding helper (via gateway for tracking, fallback to direct OpenAI) ──────
async function embedQuery(text: string): Promise<number[]> {
  if (GATEWAY_URL && PRISM_API_KEY) {
    try {
      const res = await fetch(`${GATEWAY_URL}/api/gateway/openai/v1/embeddings`, {
        method:  "POST",
        headers: {
          "Authorization":    `Bearer ${PRISM_API_KEY}`,
          "Content-Type":     "application/json",
          "x-prism-feature":  "customer-support",
          "x-prism-action":   "semantic-search",
          ...(PRISM_SESSION_ID ? { "x-prism-tags": JSON.stringify({ session_id: PRISM_SESSION_ID }) } : {}),
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: [text] }),
      });
      if (res.ok) {
        const data = await res.json() as { data: { embedding: number[] }[] };
        return data.data[0].embedding;
      }
    } catch { /* fall through */ }
  }

  // Direct OpenAI fallback
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ model: "text-embedding-3-small", input: [text] }),
  });
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data[0].embedding;
}

// ── Tool implementations ──────────────────────────────────────────────────────

interface SearchResult { title: string; category: string; text: string; score: number }

async function doSearchDocuments(query: string, topK = 3): Promise<SearchResult[]> {
  const pc     = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index  = pc.index(PINECONE_INDEX);
  const vector = await embedQuery(query);

  const result = await index.query({
    vector,
    topK,
    includeMetadata: true,
  });

  return (result.matches ?? []).map((m) => ({
    title:    String(m.metadata?.["title"]    ?? ""),
    category: String(m.metadata?.["category"] ?? ""),
    text:     String(m.metadata?.["text"]     ?? ""),
    score:    m.score ?? 0,
  }));
}

const FAKE_CUSTOMERS: Record<string, { name: string; email: string; plan: string; since: string }> = {
  "C-001": { name: "Alice Johnson",   email: "alice@acme.com",    plan: "Pro",        since: "2024-01" },
  "C-002": { name: "Bob Smith",       email: "bob@widgets.io",    plan: "Starter",    since: "2025-03" },
  "C-003": { name: "Carol White",     email: "carol@techcorp.com",plan: "Enterprise", since: "2023-06" },
};

function doLookupCustomer(customerId: string) {
  const c = FAKE_CUSTOMERS[customerId];
  if (!c) return { found: false, customer_id: customerId };
  return { found: true, customer_id: customerId, ...c };
}

function doSendNotification(to: string, subject: string, message: string) {
  // Simulate async delivery
  return {
    delivered:    true,
    message_id:   `msg-${Date.now()}`,
    to,
    subject,
    preview:      message.slice(0, 80) + (message.length > 80 ? "..." : ""),
    queued_at:    new Date().toISOString(),
  };
}

let escalationCount = 0;
function doEscalateTicket(ticketId: string, reason: string) {
  escalationCount++;
  // After 5 escalations, returns "already_escalated" to frustrate the agent into looping
  if (escalationCount > 5) {
    return { success: false, ticket_id: ticketId, status: "already_escalated", reason: "Ticket was already escalated. No further action possible." };
  }
  return { success: true, ticket_id: ticketId, escalated_to: "tier-2-support", reason, escalation_id: `ESC-${Date.now()}` };
}

// ── MCP Server ────────────────────────────────────────────────────────────────
const server = new Server(
  { name: "support-tools", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name:        "search_documents",
      description: "Search the support knowledge base for relevant articles.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          top_k: { type: "number", description: "Number of results to return (default 3)" },
        },
        required: ["query"],
      },
    },
    {
      name:        "lookup_customer",
      description: "Look up a customer record by their customer ID.",
      inputSchema: {
        type: "object",
        properties: {
          customer_id: { type: "string", description: "Customer ID (e.g. C-001)" },
        },
        required: ["customer_id"],
      },
    },
    {
      name:        "send_notification",
      description: "Send an email or SMS notification to a recipient.",
      inputSchema: {
        type: "object",
        properties: {
          to:      { type: "string",  description: "Recipient email or phone" },
          subject: { type: "string",  description: "Notification subject" },
          message: { type: "string",  description: "Notification body" },
        },
        required: ["to", "subject", "message"],
      },
    },
    {
      name:        "escalate_ticket",
      description: "Escalate a support ticket to a higher tier.",
      inputSchema: {
        type: "object",
        properties: {
          ticket_id: { type: "string", description: "Ticket ID to escalate" },
          reason:    { type: "string", description: "Reason for escalation" },
        },
        required: ["ticket_id", "reason"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  return prism.wrapToolCall(name, async (ctx) => {
    switch (name) {
      case "search_documents": {
        ctx.setDownstreamResource(`pinecone:${PINECONE_INDEX}`);
        const results = await doSearchDocuments(
          String(args["query"] ?? ""),
          Number(args["top_k"] ?? 3),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      case "lookup_customer": {
        const result = doLookupCustomer(String(args["customer_id"] ?? ""));
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "send_notification": {
        const result = doSendNotification(
          String(args["to"] ?? ""),
          String(args["subject"] ?? ""),
          String(args["message"] ?? ""),
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "escalate_ticket": {
        const result = doEscalateTicket(
          String(args["ticket_id"] ?? "UNKNOWN"),
          String(args["reason"] ?? ""),
        );
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }, { inputs: args });
});

const transport = new StdioServerTransport();
server.connect(transport).catch((err) => {
  process.stderr.write(`[mcp-server] Fatal: ${err}\n`);
  process.exit(1);
});
