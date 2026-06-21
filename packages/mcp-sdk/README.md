# @prism-llm-labs/mcp-sdk

MCP middleware for [Prism](https://useprism.dev) observability. Instruments any
[Model Context Protocol](https://modelcontextprotocol.io) server — tracking **tool, resource,
prompt, and sampling** calls — and adds **session budgets**, **loop detection**, opt-in I/O
capture, and downstream-resource cost attribution.

```bash
npm install @prism-llm-labs/mcp-sdk
```

## Quick start

Wrap each tool call with `wrapToolCall`. Cost, latency, status, and attribution are captured
fire-and-forget; tool cost comes from the catalog unless you report the real figure.

```typescript
import { PrismMCP } from "@prism-llm-labs/mcp-sdk";

const prism = new PrismMCP({
  prismKey:        process.env.PRISM_API_KEY,
  serverName:      "my-mcp-server",
  sessionBudgetUsd: 0.50,        // throws before the call if the session is over budget
  maxToolCallsPerSession: 40,    // throws if an agent loops past this many calls
});

const result = await prism.wrapToolCall("search", async (ctx) => {
  ctx.setDownstreamResource("pinecone:product-index");   // feeds the infra cost breakdown
  return pinecone.query({ /* … */ });
});
```

## Drop-in handler patch

Patch the MCP SDK request handlers directly — inputs are captured automatically when
`captureInputs` is on:

```typescript
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

server.setRequestHandler(
  CallToolRequestSchema,
  prism.patchHandler(async (req, ctx) => {
    // your existing tool logic; ctx.reportActualCost(...) is available
    return runTool(req.params.name, req.params.arguments);
  }),
);
```

`patchResourceHandler`, `patchPromptHandler`, and `wrapSamplingHandler` do the same for
`resources/read`, `prompts/get`, and `sampling/createMessage`.

## Actual cost & downstream resources

Inside any wrapped call, the `WrapContext` (`ctx`) lets you:

```typescript
await prism.wrapToolCall("invoke_lambda", async (ctx) => {
  const res = await lambda.invoke({ FunctionName: "fn", Payload: payload });
  ctx.reportActualCost(0.0000167);                 // override the catalog estimate with real cost
  ctx.setDownstreamResource("aws:lambda");          // tag the downstream resource
  return res;
});
```

For AWS, use [`@prism-llm-labs/aws-helpers`](../aws-helpers) to extract real costs automatically.

## Session budgets & loop detection

`sessionBudgetUsd` and `maxToolCallsPerSession` are enforced **before** each call. When exceeded,
the wrapper throws `PrismSessionBudgetExceededError` / `PrismToolCallLimitError` **and** fires
`prism.signal` (an `AbortSignal`) so you can cancel inflight work:

```typescript
const res = await openai.chat.completions.create(
  { model: "gpt-4o", messages },
  { signal: prism.signal },   // cancels the LLM call if the session budget is hit
);
```

Call `prism.endSession({ success: true, valueUsd })` (or set `autoOutcome: true`) to record a
session outcome for Unit Economics.

## Options

| Option | Description |
|---|---|
| `prismKey` | Prism API key (falls back to `PRISM_API_KEY`) |
| `serverName` | Name shown in the dashboard |
| `project` / `team` / `environment` | Attribution (fall back to `PRISM_*` env vars) |
| `sessionId` | Group calls into one session (default: random UUID) |
| `sessionBudgetUsd` | Hard session budget; throws when exceeded |
| `maxToolCallsPerSession` | Loop guard; throws when exceeded |
| `captureInputs` / `captureOutputs` | Opt-in I/O capture (redacted) |
| `customerId` | Attribute the session to a customer (Customers P&L) |
| `ingestUrl` | Override the Prism ingest URL (self-hosted) |

Telemetry is fire-and-forget — failures never break your server.

## Requirements

Node ≥ 18 · `@modelcontextprotocol/sdk >= 1.0.0` (peer). For Python MCP, use `PrismMCP` from
[`prism-llm-labs[mcp]`](../python-sdk); for zero-code wrapping, see
[`@prism-llm-labs/mcp-proxy`](../mcp-proxy).
