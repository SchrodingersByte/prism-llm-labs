# @prism-llm-labs/langchain

A [LangChain.js](https://js.langchain.com) callback handler that ships LLM cost and usage
telemetry to your [Prism](https://useprism.dev) dashboard. Drop it into any LangChain model,
chain, or agent run — no other changes — and every model call is captured with cost, tokens,
latency, and attribution.

```bash
npm install @prism-llm-labs/langchain
```

> Requires `@langchain/core >= 0.3.0` (peer).

## Usage

Attach the handler via `callbacks` — on the model, or per call:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { PrismCallbackHandler } from "@prism-llm-labs/langchain";

const prism = new PrismCallbackHandler({
  prismKey:    process.env.PRISM_API_KEY,
  project:     "my-app",
  environment: "production",
});

const model = new ChatOpenAI({ model: "gpt-4o", callbacks: [prism] });

await model.invoke("Summarize the latest release notes");
// ↑ cost, tokens, latency, model & attribution captured automatically
```

You can also pass it per invocation, or to a chain / agent:

```typescript
await chain.invoke({ input: "…" }, { callbacks: [prism] });
```

## Options

`PrismCallbackHandler` accepts the standard Prism attribution options (`prismKey`, `project`,
`team`, `environment`), falling back to the usual `PRISM_*` environment variables. See
[`@prism-llm-labs/sdk`](../typescript-sdk) for the full option list and what gets tracked.

Telemetry is fire-and-forget — a failure never interrupts your LangChain run.

## Requirements

Node ≥ 18 · `@langchain/core >= 0.3.0`.
