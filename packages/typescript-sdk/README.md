# @prism-llm-labs/sdk

LLM cost, usage, and quality observability for TypeScript / Node.js. Drop-in replacements for
the **OpenAI**, **Anthropic**, and **Google Generative AI** clients that ship telemetry to your
[Prism](https://useprism.dev) dashboard in the background — zero latency impact — plus helpers
for tracing, CI evals, end-user feedback, and a managed prompt registry.

```bash
npm install @prism-llm-labs/sdk
# pnpm add @prism-llm-labs/sdk · yarn add @prism-llm-labs/sdk
```

## Contents
- [Quick start](#quick-start) · [Gateway mode](#gateway-mode) · [Budgets](#budget-enforcement) · [Streaming](#streaming)
- [Attribution & typed tags](#attribution--typed-tags) · [Tracing](#tracing) · [Next.js middleware](#nextjs-middleware)
- [CI evals](#ci-evals) · [Feedback](#end-user-feedback) · [Prompt registry](#prompt-registry) · [Circuit breaker](#circuit-breaker)
- [Cost utilities](#cost-utilities) · [Configuration](#configuration) · [What gets tracked](#what-gets-tracked)

---

## Quick start

```typescript
import { OpenAI } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  apiKey:      process.env.OPENAI_API_KEY,
  prismKey:    process.env.PRISM_API_KEY,   // dashboard → Settings → Access → API Keys
  project:     "my-app",
  environment: "production",
});

// Identical to openai.OpenAI — no other changes needed
const res = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});
```

Every call captures model, input/output/cached tokens, cost (USD), latency, status code, and
request ID — shipped asynchronously.

### Anthropic

```typescript
import { PrismAnthropic } from "@prism-llm-labs/sdk";

const client = new PrismAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY, prismKey: process.env.PRISM_API_KEY, project: "my-app" });
const res = await client.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});
```

### Google Gemini

```typescript
import { PrismGoogleGenerativeAI } from "@prism-llm-labs/sdk";

const client = new PrismGoogleGenerativeAI({ apiKey: process.env.GOOGLE_API_KEY, prismKey: process.env.PRISM_API_KEY, project: "my-app" });
const model = client.getGenerativeModel({ model: "gemini-1.5-pro" });
const result = await model.generateContent("Explain quantum computing");
```

> Canonical names `PrismOpenAI` / `PrismAsyncOpenAI` / `PrismGoogleAI` are also exported; `OpenAI`
> is kept as a drop-in alias.

---

## Gateway mode

Route traffic through Prism's proxy to unlock **streaming analytics**, a **provider-key vault**
(no provider key in your app), and **zero patching**:

```typescript
const client = new OpenAI({
  prismKey: process.env.PRISM_API_KEY,
  project:  "my-app",
  mode:     "gateway",   // or set PRISM_GATEWAY_URL — auto-detected
});
```

Also available on `PrismAnthropic`. The gateway additionally enforces model policies, data
residency, spend caps, fallbacks, and content guardrails before the provider is called.

---

## Budget enforcement

If a hard budget cap is set for your project, the SDK checks current spend before each call and
throws `BudgetExceededError` when the limit is hit (a fast ~2 ms Upstash Redis check — never the
provider):

```typescript
import { OpenAI, BudgetExceededError } from "@prism-llm-labs/sdk";

try {
  await client.chat.completions.create({ /* … */ });
} catch (err) {
  if (err instanceof BudgetExceededError) {
    // fall back to a cheaper model or a cached response
  }
}
```

---

## Streaming

**SDK mode does not track streaming calls** — usage is only in the final chunk, consumed in your
code outside Prism's control, so Prism skips them to avoid zero-token events. **Use gateway mode
for streaming analytics** — the proxy tees the SSE stream and captures usage automatically.

---

## Attribution & typed tags

Attribute spend to a feature, action, or cost center per call with the typed `prismTags` helper
(builds the `x-prism-*` headers, with autocomplete):

```typescript
import { prismTags } from "@prism-llm-labs/sdk";

await client.chat.completions.create(
  { model: "gpt-4o", messages },
  { headers: prismTags({ feature: "chat", action: "reply", costCenter: "eng-product" }) },
);
```

`feature` → Unit Economics → *cost by feature*; `action` → *cost per action*; `costCenter` →
FinOps chargeback. Extra keys map to `x-prism-<key>` (e.g. `{ "customer-id": "acme" }`).

---

## Tracing

Wrap any async work in a span so all LLM calls inside inherit `trace_id` + `parent_span_id` and
form a hierarchical tree in the Trace Explorer. Tag a `downstream_resource` (vector DB, etc.) to
feed the infrastructure cost breakdown:

```typescript
import { trace } from "@prism-llm-labs/sdk";

const answer = await trace("rag-answer", async () => {
  const docs = await trace("vector-search", () => pinecone.query({ /* … */ }),
    { downstream_resource: "pinecone:product-index" });
  return client.chat.completions.create({ model: "gpt-4o", messages: build(docs) });
}, { cost_center_code: "ENGR-001" });
```

`traceStream(name, fn, opts)` does the same for streaming generators; `getCurrentTrace()` reads
the active context.

---

## Next.js middleware

Auto-tag every LLM API route with `x-prism-feature` so feature attribution works without editing
each handler:

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import { createPrismMiddleware } from "@prism-llm-labs/sdk";

const tag = createPrismMiddleware({
  // optional explicit map; otherwise inferred from the path (/api/chat → "chat")
  featureMap: { "/api/chat": "chat-assistant", "/api/summarize": "summarize" },
});

export function middleware(request: Request) {
  tag(request);
  return NextResponse.next();
}
```

---

## CI evals

Gate your pipeline on quality: run a dataset through a subject (model + prompt + params), score it
server-side, and fail the build on a low score or a regression vs a baseline run.

```typescript
import { gateEval } from "@prism-llm-labs/sdk";

await gateEval({
  dataset: "DATASET_UUID",            // or items: [{ input, expected_output }]
  subject: { model: "gpt-4o-mini" },
  scorers: ["correctness"],
  threshold: 0.8,
  baselineRunId: process.env.PRISM_BASELINE_RUN_ID,
}); // throws EvalGateError when it doesn't pass
```

Or run without throwing via `runEval(opts)` and inspect `result.passed` / `result.scoreDelta`.
A CLI is bundled as **`prism-evals`** (reads a JSON config and exits non-zero on failure):

```bash
npx prism-evals ./prism.eval.json
```

---

## End-user feedback

Record 👍/👎 or a 0–1 score linked to a trace (defaults to the active `trace()` context):

```typescript
import { sendFeedback } from "@prism-llm-labs/sdk";

await sendFeedback({ value: 1, comment: "spot on" });            // 👍 on current trace
await sendFeedback({ value: 0, traceId, featureTag: "support" }); // 👎 on a specific trace
```

Reviewer scores and end-user thumbs feed the Quality dashboard and calibrate the LLM judge.

---

## Prompt registry

Resolve a managed prompt by name + label at runtime — ship prompt changes by promoting a label,
no redeploy. Results are cached in-memory by name+label with a short TTL.

```typescript
import { getPrompt } from "@prism-llm-labs/sdk";

const p = await getPrompt("support-reply", { label: "production" });
const messages = p.compile({ customer: "Dana" });   // fills {{customer}}

await client.chat.completions.create(
  { model: "gpt-4o", messages },
  { headers: prismTags({ feature: "support" }) },   // stamp p.promptVersion for attribution
);
```

---

## Circuit breaker

Short-circuit calls to a provider that's failing, in SDK mode:

```typescript
import { isCircuitOpen, recordProviderError, resetBreaker, PrismCircuitOpenError } from "@prism-llm-labs/sdk";
```

---

## Cost utilities

```typescript
import { calculateCost, MODEL_PRICING } from "@prism-llm-labs/sdk";

const usd = calculateCost("gpt-4o", { inputTokens: 1200, outputTokens: 350, cachedTokens: 800 });
```

`MODEL_PRICING` is the per-model rate table used for cost calculation (kept in sync with the
dashboard's pricing table).

---

## Configuration

### Constructor options (all providers)

| Option | Type | Description |
|---|---|---|
| `prismKey` | `string` | Prism API key. Falls back to `PRISM_API_KEY` |
| `project` | `string` | Project name. Falls back to `PRISM_PROJECT` |
| `team` | `string` | Team identifier. Falls back to `PRISM_TEAM` |
| `environment` | `string` | `production` / `staging` / `development`. Falls back to `PRISM_ENVIRONMENT` |
| `mode` | `"sdk" \| "gateway"` | `"sdk"` (default) patches the client; `"gateway"` routes via the Prism proxy |
| `ingestUrl` | `string` | Override the Tinybird ingest URL (e.g. US region) |

Standard provider-SDK options (`apiKey`, `baseURL`, …) are passed through unchanged.

### Environment variables

```bash
PRISM_API_KEY=prism_live_...
PRISM_PROJECT=my-project
PRISM_TEAM=backend-team            # optional
PRISM_ENVIRONMENT=production       # default: production
PRISM_GATEWAY_URL=https://useprism.dev   # enables gateway mode + base URL for helpers
```

---

## What gets tracked

Tokens (input / output / cached), cost (USD), latency, model & provider, project / team /
environment, request ID, and status code. Telemetry is fire-and-forget — a failure is swallowed
so your app is never affected.

## Requirements

Node ≥ 18 · `openai` peer dep for `OpenAI` · `@anthropic-ai/sdk` for `PrismAnthropic` ·
`@google/generative-ai` for `PrismGoogleGenerativeAI`.
