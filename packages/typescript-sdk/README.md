# @prism-llm-labs/sdk

LLM cost and usage observability for TypeScript/Node.js. Drop-in replacements for the OpenAI, Anthropic, and Google Generative AI clients that send telemetry to your [Prism](https://useprism.dev) dashboard in the background — zero latency impact.

## Install

```bash
npm install @prism-llm-labs/sdk
# or
pnpm add @prism-llm-labs/sdk
# or
yarn add @prism-llm-labs/sdk
```

## Quick start — OpenAI

```typescript
import { OpenAI } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  prismKey: process.env.PRISM_API_KEY,  // from dashboard → API Keys
  project: "my-app",
  environment: "production",
});

// Use exactly like openai.OpenAI — no other changes needed
const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
console.log(response.choices[0].message.content);
```

Every call automatically captures: model, input/output/cached tokens, cost in USD, latency, status code, and request ID — shipped to Tinybird asynchronously.

## Anthropic

```typescript
import { PrismAnthropic } from "@prism-llm-labs/sdk";

const client = new PrismAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  prismKey: process.env.PRISM_API_KEY,
  project: "my-app",
});

const response = await client.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

## Google Gemini

```typescript
import { PrismGoogleGenerativeAI } from "@prism-llm-labs/sdk";

const client = new PrismGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY,
  prismKey: process.env.PRISM_API_KEY,
  project: "my-app",
});

const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
const result = await model.generateContent("Explain quantum computing");
console.log(result.response.text());
```

## Gateway mode

Gateway mode routes your LLM traffic through Prism's cloud proxy. This enables:
- **Streaming analytics** — Prism tees the SSE stream and captures usage from the final chunk
- **Provider key vault** — no provider API key needed in your app; Prism decrypts it server-side
- **Zero patching** — the underlying SDK calls the Prism proxy directly

```typescript
import { OpenAI } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  prismKey: process.env.PRISM_API_KEY,
  project: "my-app",
  mode: "gateway",
  // PRISM_APP_URL defaults to https://useprism.dev
});

// Streaming now tracked automatically
const stream = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
}
```

Also available for Anthropic:

```typescript
import { PrismAnthropic } from "@prism-llm-labs/sdk";

const client = new PrismAnthropic({
  prismKey: process.env.PRISM_API_KEY,
  project: "my-app",
  mode: "gateway",
});
```

## Budget enforcement

If a hard budget cap is set for your project in the Prism dashboard, the SDK checks current spend before each call and throws `BudgetExceededError` if the limit is reached:

```typescript
import { OpenAI, BudgetExceededError } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  prismKey: process.env.PRISM_API_KEY,
  project: "my-app",
});

try {
  const response = await client.chat.completions.create({ /* ... */ });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error("Budget exceeded:", err.message);
  }
}
```

Budget checks are fast (<2 ms) HTTP calls to Upstash Redis — they never hit the LLM provider.

## Streaming

**In SDK (direct) mode**, streaming calls are **not tracked**. When `stream: true` is passed, the provider SDK returns a `Stream` async-iterable — usage data is only available after the stream is fully consumed, which happens in your code outside Prism's control. Prism skips these calls to avoid recording zero-token events that corrupt cost dashboards.

**Use gateway mode for streaming analytics.** Prism's proxy tees the SSE stream server-side and captures the usage from the final chunk automatically.

```typescript
// SDK mode — streaming NOT tracked
const client = new OpenAI({ prismKey: "...", project: "my-app" });
const stream = await client.chat.completions.create({ stream: true, /* ... */ });

// Gateway mode — streaming IS tracked
const client = new OpenAI({ prismKey: "...", project: "my-app", mode: "gateway" });
const stream = await client.chat.completions.create({ stream: true, /* ... */ });
```

## Configuration

### Constructor options

All providers accept these Prism-specific options alongside the standard SDK options:

| Option | Type | Description |
|---|---|---|
| `prismKey` | `string` | Your Prism API key. Falls back to `PRISM_API_KEY` env var |
| `project` | `string` | Project name shown in the dashboard. Falls back to `PRISM_PROJECT` |
| `team` | `string` | Team identifier for per-member cost attribution. Falls back to `PRISM_TEAM` |
| `environment` | `string` | `production` / `staging` / `development`. Falls back to `PRISM_ENVIRONMENT` |
| `mode` | `"sdk" \| "gateway"` | `"sdk"` (default) patches the client; `"gateway"` routes via Prism proxy |
| `ingestUrl` | `string` | Override the Tinybird ingest URL (US region: use `https://api.us-east.tinybird.co/v0/events?name=llm_events`) |

### Environment variables

```bash
PRISM_API_KEY=prism_live_...          # your Prism API key
PRISM_PROJECT=my-project              # project name
PRISM_TEAM=backend-team               # team identifier (optional)
PRISM_ENVIRONMENT=production          # environment tag (default: production)
PRISM_APP_URL=https://useprism.dev    # gateway mode proxy URL (default: useprism.dev)
```

## Supported models

Cost is calculated automatically for:

| Provider | Models |
|---|---|
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-3.5-turbo`, `text-embedding-3-small`, `text-embedding-3-large` |
| Anthropic | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022`, `claude-3-opus-20240229` |
| Google | `gemini-1.5-pro`, `gemini-1.5-flash` |

Unknown models are recorded with `cost_usd = 0` and surfaced as "unknown model" in the dashboard.

## What gets tracked

Every LLM call records:

- **Tokens** — input, output, and cached tokens separately
- **Cost** — calculated from the pricing table, stored as `Float64` USD
- **Latency** — wall-clock time from request start to response return
- **Model & provider** — normalized model name and provider
- **Project & team** — for cost attribution in the dashboard
- **Environment** — production / staging / development split
- **Request ID** — provider's response ID for cross-referencing logs
- **Status code** — 200 on success, 4xx/5xx on errors

Telemetry is fire-and-forget — if it fails, the error is silently swallowed so your app continues unaffected.

## Requirements

- Node.js ≥ 18
- TypeScript ≥ 4.7 (if using TypeScript)
- `openai` peer dependency for `OpenAI`
- `@anthropic-ai/sdk` peer dependency for `PrismAnthropic`
- `@google/generative-ai` peer dependency for `PrismGoogleGenerativeAI`
