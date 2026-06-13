# Prism

**See exactly where your AI money goes.**

Prism is an open-source LLM cost and usage observability SDK. Swap one import, get a real-time dashboard showing which team, project, and feature is driving your OpenAI bill — with budget alerts before surprises hit your invoice.

```python
# Before
from openai import OpenAI

# After — nothing else changes
from prism import OpenAI
```

---

## Why Prism

Every team using LLM APIs has the same problem: one aggregate number at the end of the month, zero attribution, and no way to know which feature caused the spike until weeks after it happened.

Prism solves this with a zero-config SDK wrapper that intercepts every API call, attributes it to the right team and project, calculates the cost, and streams the data to a dashboard that updates in real time.

**What you get in 5 minutes:**
- Every LLM call attributed to a project, team, and environment
- Real-time spend dashboard with daily and monthly breakdowns
- Budget alerts via Slack or email before you hit your limit
- Model efficiency recommendations (right-sizing, caching opportunities, duplicate detection)
- No infrastructure to run — fully managed, free tier included

---

## Quick Start

### Python

```bash
pip install prism-llm-labs
```

```python
import os
from prism import OpenAI

os.environ["PRISM_API_KEY"]   = "prism_live_xxxx"  # from useprism.dev/dashboard
os.environ["PRISM_PROJECT"]   = "customer-support-bot"
os.environ["PRISM_TEAM"]      = "product-eng"
os.environ["PRISM_ENVIRONMENT"] = "production"

client = OpenAI()  # identical to openai.OpenAI()

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Summarize this ticket: ..."}],
)
# ^ This call is now tracked. Cost, tokens, latency, attribution — all captured.
```

### TypeScript / Node

```bash
npm install @prism-llm-labs/sdk
```

```typescript
import { OpenAI } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  // All standard openai options work identically
  apiKey: process.env.OPENAI_API_KEY,
  // Prism-specific (or set as env vars)
  prismKey: process.env.PRISM_API_KEY,
  project: "document-parser",
  team: "data-eng",
});

const response = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Extract the key clauses from..." }],
});
```

### Async Python

```python
from prism import AsyncOpenAI

client = AsyncOpenAI()

async def summarize(text: str) -> str:
    response = await client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": text}],
    )
    return response.choices[0].message.content
```

---

## Attribution

Every call needs to know which project and team it came from. Set via environment variables or constructor arguments.

**Environment variables** (recommended for production services):

```bash
PRISM_API_KEY=prism_live_xxxx
PRISM_PROJECT=customer-support-bot    # maps to a project in your dashboard
PRISM_TEAM=product-eng                # maps to a team member group
PRISM_ENVIRONMENT=production          # production | staging | development
```

**Per-service override** (for monorepos with multiple services):

```python
# Service A
client_a = OpenAI(project="chat-feature", team="frontend-eng")

# Service B in the same process
client_b = OpenAI(project="doc-parser", team="data-eng")
```

**Call-level tags** (for feature-level breakdown within a service):

```python
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[...],
    extra_headers={"X-Prism-Tags": "feature=summary,experiment=v2"},
)
```

---

## Dashboard

Sign up at [useprism.dev](https://useprism.dev) to get your API key and access the dashboard.

The dashboard shows:

**Overview** — Total spend this month, today vs yesterday, projected end-of-month, spend trend over 30 days, top projects by cost, spend by model.

**Projects** — Per-project drill-down with hourly spend charts, token breakdown (input vs output vs cached), average cost per request, context window utilization, and request volume.

**Team** — Per-developer spend, budget utilization, and most expensive individual calls.

**Models** — Cross-project model comparison, output/input token ratio, cost-per-request by model, and model right-sizing recommendations.

**Alerts** — Configure budget thresholds, spend spike detection, and error rate monitors with delivery to Slack, email, or any webhook.

---

## Budget Controls

Set budgets per project or per developer. Prism will alert you (or hard-block calls) before limits are hit.

```python
# Alert-only mode: get notified at 80% of budget, calls continue
# Configure in dashboard under Projects > [your project] > Budget

# Hard-cap mode: calls return PrismBudgetExceededError when budget is hit
# Enable in dashboard under Projects > [your project] > Budget > Enforcement
```

When a hard cap is hit, the SDK raises `prism.PrismBudgetExceededError`. Handle it in your application:

```python
from prism import OpenAI, PrismBudgetExceededError

client = OpenAI()

try:
    response = client.chat.completions.create(...)
except PrismBudgetExceededError:
    # Fall back to a cheaper model or return a cached response
    response = fallback_response()
```

---

## Streaming Support

Streaming responses are fully supported. Prism automatically injects `stream_options={"include_usage": True}` to capture accurate token counts from the stream's final chunk.

```python
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story..."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)

# Token count and cost are captured automatically when stream ends
```

---

## Supported Providers

| Provider | Python | TypeScript | Notes |
|----------|--------|------------|-------|
| OpenAI (direct) | ✅ | ✅ | All chat + embedding models |
| Azure OpenAI | ✅ | ✅ | Auto-detected from `base_url` |
| Anthropic | ✅ | 🔜 v1.1 | claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus |
| Google Gemini | 🔜 v1.2 | 🔜 v1.2 | gemini-1.5-pro, gemini-1.5-flash |

---

## Architecture

```
Your Application
      │
      │  from prism import OpenAI
      ▼
┌─────────────────┐
│   Prism SDK     │  Intercepts call
│                 │  ├─ Budget check  (Upstash Redis, <2ms, sync)
│                 │  ├─ Forward call  → LLM Provider (unchanged)
│                 │  └─ Capture event (Tinybird ingest, async, non-blocking)
└────────┬────────┘
         │                         │
         ▼                         ▼
   LLM Provider           Tinybird (ClickHouse)
  (OpenAI, etc.)          Real-time event store
                                   │
                          ┌────────▼────────┐
                          │  Prism Dashboard │
                          │  (Next.js/Vercel) │
                          └─────────────────┘
```

The SDK never buffers or stores your prompt content. Only metadata is captured:
model name, token counts, cost, latency, status code, and your attribution tags.
Your prompt text never touches Prism's infrastructure.

---

## Fail-Safe Design

Prism is built to never be the reason your application breaks.

- **Fail open**: If Prism's ingestion endpoint is unreachable, the SDK logs a warning and your LLM call succeeds normally. You lose observability data for that call — your application never fails.
- **Non-blocking**: Event capture runs in a daemon background thread (Python) or unawaited Promise (TypeScript). The SDK adds zero blocking latency beyond the budget check.
- **Budget circuit breaker**: Hard-cap enforcement can be disabled per-project at any time from the dashboard without a code change.

---

## Self-Hosting

Prism is open-source and can be self-hosted. You'll need:

- A [Tinybird](https://tinybird.co) account (or self-hosted ClickHouse with the Tinybird schema)
- A [Supabase](https://supabase.com) project
- An [Upstash](https://upstash.com) Redis database
- Node 20+ for the web app

```bash
git clone https://github.com/your-org/prism
cd prism
cp apps/web/.env.example apps/web/.env.local
# Fill in your Tinybird, Supabase, and Upstash credentials

pnpm install
cd tinybird && tb push --force   # push event schema
pnpm --filter web dev            # start dashboard at localhost:3000
```

See `CLAUDE.md` for the full Supabase migration SQL and Tinybird pipe definitions.

---

## Pricing

All plans start with a **14-day free trial** — no credit card required. Trial begins when your first tracked event arrives, not at signup. Payments via Razorpay (cards, UPI, netbanking). Prices in INR; international cards accepted.

| Plan | Price | Events/day | Projects | History | Alerts |
|------|-------|-----------|----------|---------|--------|
| **Starter** | ₹2,499/mo | 2M | 5 | 30 days | Email |
| **Growth** | ₹8,499/mo | 20M | Unlimited | 90 days | Email + Slack + Webhook |
| **Scale** | ₹24,999/mo | Unlimited | Unlimited | 1 year | All + SSO + priority support |

Annual plans available at 20% discount. No per-seat pricing. SDKs are always free and open source.

Sign up at [useprism.dev](https://useprism.dev).

---

## Contributing

Contributions are welcome. The SDK is MIT licensed.

```bash
# Python SDK
cd packages/python-sdk
pip install -e ".[dev]"
pytest

# TypeScript SDK
cd packages/typescript-sdk
pnpm install && pnpm test

# Web app
cd apps/web
pnpm dev
```

Please open an issue before starting significant new features. The roadmap is tracked in [GitHub Issues](https://github.com/your-org/prism/issues).

### Updating the Pricing Table

Model prices change frequently. To update:

1. Edit `apps/web/lib/pricing/table.ts`
2. Mirror the change in `packages/python-sdk/prism/_pricing.py`
3. Open a PR with the source (e.g., link to OpenAI pricing page)

---

## Roadmap

- [x] Python SDK (OpenAI + Azure OpenAI)
- [x] TypeScript/Node SDK
- [x] Real-time cost dashboard
- [x] Budget controls (alert-only + hard cap)
- [x] Slack + email + webhook alerts
- [x] Efficiency recommendations
- [ ] Anthropic TypeScript SDK support (v1.1)
- [ ] Google Gemini SDK support (v1.2)
- [ ] LangChain / LlamaIndex integration (v1.3)
- [ ] Cost anomaly ML model (v2)
- [ ] Performance monitoring — latency + quality scoring (v2)
- [ ] dbt package for self-hosted analytics (v2)
- [ ] Stripe billing integration (v2)

---

## License

MIT — see [LICENSE](LICENSE)

The Prism dashboard (hosted at useprism.dev) is a commercial product. The SDK packages (`prism-llm`, `@prism-llm-labs/sdk`) and this repository are open source under MIT.

---

*Built with [Tinybird](https://tinybird.co), [Supabase](https://supabase.com), [Vercel](https://vercel.com), and [Upstash](https://upstash.com).*