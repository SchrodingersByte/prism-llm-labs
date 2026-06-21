<div align="center">

# Prism

**AI FinOps & LLM observability — see, govern, and optimize every model dollar.**

Swap one import (or one URL) and get real-time cost, usage, governance, quality, and unit
economics across **16+ providers** — in one platform.

[![npm](https://img.shields.io/npm/v/@prism-llm-labs/sdk?label=%40prism-llm-labs%2Fsdk)](https://www.npmjs.com/package/@prism-llm-labs/sdk)
[![PyPI](https://img.shields.io/pypi/v/prism-llm-labs?label=prism-llm-labs)](https://pypi.org/project/prism-llm-labs/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

```python
# Before
from openai import OpenAI
# After — nothing else changes
from prism import OpenAI
```

---

## What is Prism?

Most teams shipping LLM features get one aggregate invoice at the end of the month — no
attribution, no guardrails, and no idea which feature caused a spike until weeks later.

**Prism turns every model and tool call into observability, governance, and unit economics.**
Capture usage with a drop-in SDK or an optional policy gateway, then track spend by team,
project, feature, and customer; enforce budgets, model policies, and content guardrails on
the request path; and prove prompt/model changes with evals — all backed by a sub-second
analytics pipeline.

It ships as three deployable artifacts plus a package ecosystem:

- **Web app** (`apps/web`) — Next.js 14 dashboard + REST API
- **TypeScript SDK** — [`@prism-llm-labs/sdk`](packages/typescript-sdk)
- **Python SDK** — [`prism-llm-labs`](packages/python-sdk)

---

## Two ways to send data

| | SDK mode (default) | Gateway mode |
|---|---|---|
| **How** | Wraps your provider client in-process | One OpenAI-compatible endpoint per provider |
| **Traffic** | Your calls go straight to the provider; only telemetry ships to Prism | Calls proxy through Prism, then to the provider |
| **Enable** | `from prism import OpenAI` | Set `PRISM_GATEWAY_URL` (auto-detected) |
| **Unlocks** | Zero added latency on the wire | Inline policy, fallbacks, guardrails, streaming analytics, provider-key vault |

Same one-line integration — pick the path per service.

---

## Features

### 1. Capture everything
One integration, every call recorded — your way, with no call-site changes.
- **Universal gateway** — one OpenAI-compatible endpoint for 16+ providers, with inline policy, fallback chains, and capture.
- **Drop-in SDKs** — TypeScript & Python clients; swap a single import.
- **MCP & tool tracking** — wrap tool calls and attribute vector-DB cost via `downstream_resource` (Pinecone, Qdrant).
- **Enforce & proxy** — an import interceptor and a zero-code MCP proxy CLI surface any un-instrumented traffic.

### 2. Cost & usage observability
Live cost, usage, and performance across every model, provider, session, and project.
- **Command Center** — customizable overview: cost, requests, tokens, error rate, spend trend, with role templates.
- **Models** — per-model spend, cache-hit rate, tokens-per-dollar, latency & TTFT percentiles, side-by-side compare.
- **Sessions & traces** — session list → trace waterfall → payload viewer, with the true cost of each session.
- **Logs** — searchable request-log explorer; jump from any row to its full trace.
- **Agents & MCP** — per-tool cost breakdown, agent loop detection, vector-DB cost attribution.

### 3. FinOps & chargeback
Attribute every dollar to the team that drove it — and stop overspend before the invoice.
- **Vendor spend & chargeback** — by provider, project, team, key, git branch, developer, and GL cost center.
- **Budgets & forecasts** — org/project budgets with burn-down; hard caps on Free, predictable overage on paid.
- **Unit economics** — cost per feature and per action, tokens-per-dollar, cache-hit rate, cost-per-outcome / ROI.
- **Infrastructure & training** — unified LLM + MCP + vector-DB + fine-tuning cost view, reconciled to actual cloud bills.
- **Anomaly detection** — automatic cost-spike detection across providers and models.

### 4. Governance & guardrails
Policy on the request path — enforced inline at the gateway, not in a spreadsheet.
- **Model governance** — allow / block / require-approval per model and scope, with an approval queue.
- **Guardrails** — warn / block / redact on input and output, with built-in PII detection and masking.
- **Spend caps & residency** — per-key multi-period caps and data-residency policies that pin traffic to a region.
- **Shadow IT** — gateway-coverage score plus SDK-bypass detection.
- **Compliance & audit** — audit log, cost reconciliation, per-project content-capture controls.

### 5. Quality & evals
Ship prompt and model changes with evidence — score, compare, review, and catch drift.
- **Quality scoring** — LLM-judge scores by model and scorer (faithfulness, answer relevancy, toxicity, hallucination…).
- **Prompt registry** — named prompts → immutable versions → movable production/staging labels, decoupled from deploys.
- **Evals & experiments** — run a subject over a dataset, compare against a baseline, and gate CI on the verdict.
- **Arena** — run one prompt against multiple models side by side with real, normalized cost.
- **Annotations & feedback** — human review queue plus end-user thumbs that calibrate the judge.
- **Drift & errors** — drift by segment and clustered error signatures that drill to the offending traces.

### 6. Operate & grow
Run the platform day to day — and connect model spend to revenue.
- **Alerts** — 12 trigger types (budget, spend spike, anomaly, error rate, tool-loop, PII, drift…) to email / Slack / webhook.
- **Customers P&L** — cost-to-serve, revenue, and gross margin per customer, with unprofitable-account flags.
- **Copilot** — ask questions in plain English; answers cite the underlying data and link to the trace.
- **Projects & teams** — project workspaces with cost attribution, four-role RBAC, invites, and per-project grants.

> Explore them interactively on the marketing site: `/features` · `/docs` · `/pricing`.

---

## Quick start

### TypeScript / Node

```bash
npm install @prism-llm-labs/sdk
```

```typescript
import { OpenAI } from "@prism-llm-labs/sdk";

const client = new OpenAI({
  apiKey:   process.env.OPENAI_API_KEY,
  prismKey: process.env.PRISM_API_KEY,   // dashboard → Settings → Access → API Keys
  project:  "support-bot",
  environment: "production",
});

// Use exactly like openai.OpenAI — cost, tokens, latency & attribution captured automatically
const res = await client.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Summarize this ticket…" }],
});
```

### Python

```bash
pip install prism-llm-labs
```

```python
from prism import OpenAI

client = OpenAI(prism_key="prism_live_...", project="support-bot")
res = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Summarize this ticket…"}],
)
```

### Gateway (any language, via cURL)

```bash
curl https://useprism.dev/api/gateway/openai/v1/chat/completions \
  -H "Authorization: Bearer $PRISM_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"Hello"}]}'
```

Your first events appear on the dashboard in real time.

---

## Environment variables

| Variable | Effect |
|---|---|
| `PRISM_API_KEY` | **Required.** Authenticates the SDK / gateway. |
| `PRISM_GATEWAY_URL` | Auto-enables gateway mode (e.g. `https://useprism.dev`). |
| `PRISM_PROJECT` | Project attribution tag. |
| `PRISM_ENVIRONMENT` | `production` \| `staging` \| `development`. |
| `PRISM_TEAM` | Team identifier for per-member attribution. |
| `PRISM_COST_CENTER` | GL code stamped as `tags['cost_center']` for chargeback. |
| `PRISM_SERVICE_NAME` | Service name for Shadow-IT / bypass detection. |

---

## Package ecosystem

| Package | Registry | What it does |
|---|---|---|
| [`@prism-llm-labs/sdk`](packages/typescript-sdk) | npm | TypeScript drop-in for OpenAI / Anthropic / Google + evals, feedback, prompts, tracing |
| [`prism-llm-labs`](packages/python-sdk) | PyPI | Python drop-in for OpenAI / Anthropic / Google + the same advanced helpers + MCP |
| [`@prism-llm-labs/mcp-sdk`](packages/mcp-sdk) | npm | MCP middleware — tracks tool/resource/prompt calls, enforces session budgets & loop limits |
| [`@prism-llm-labs/mcp-proxy`](packages/mcp-proxy) | npm | Zero-code CLI that wraps any MCP server (e.g. in Claude Desktop) |
| [`@prism-llm-labs/enforce`](packages/enforce) | npm | Import hook that auto-wraps raw provider SDKs so no spend goes untracked |
| [`@prism-llm-labs/aws-helpers`](packages/aws-helpers) | npm | Real-time AWS cost extractors for MCP tool calls (Lambda, DynamoDB, S3, Bedrock) |
| [`@prism-llm-labs/langchain`](packages/langchain-ts) | npm | LangChain callback handler for cost observability |
| `@prism-llm-labs/github-action` | (private) | Posts an LLM cost-diff comment on pull requests |

---

## Architecture

```
            Your application
                  │  SDK (in-process)   or   Gateway (proxied + governed)
                  ▼
        ┌───────────────────────┐
        │        Prism          │  budget check · policy · guardrails · capture
        └─────────┬─────────────┘
                  │ events (fire-and-forget)
   ┌──────────────┼───────────────────────────┐
   ▼              ▼                             ▼
LLM provider   Tinybird (ClickHouse)      Supabase (Postgres + RLS)
              real-time analytics          metadata: orgs, keys, projects,
              (47 pipes)                    policies, budgets, members
                  │
                  ▼
         Prism dashboard (Next.js / Vercel)   ·   Upstash Redis (budgets, rate limits)
```

**Stack**
- **Web app** — Next.js 14 App Router (dashboard + REST API), deployed on Vercel
- **Analytics** — Tinybird (managed ClickHouse); all spend/usage queries hit Tinybird pipes
- **Metadata** — Supabase (Postgres + Row-Level Security)
- **Budgets / rate limits** — Upstash Redis (sub-2ms checks)

**Providers** — OpenAI · Anthropic · Google · Azure OpenAI · AWS Bedrock · Mistral · Cohere ·
Groq · xAI · Together · Fireworks · Perplexity · OpenRouter · Cerebras · Nebius — plus Ollama
and any OpenAI-compatible endpoint.

**Fail-safe** — telemetry is fire-and-forget; if Prism is unreachable, your LLM call still
succeeds. Budget hard-caps are the only synchronous check (a ~2 ms Redis call) and can be
toggled per project without a deploy.

---

## Pricing

Metered on **telemetry events per month — not per seat.** Add your whole team within the
plan's member cap at no per-head cost.

| Plan | Price | Events / mo | Members | Retention | Overage |
|---|---|---|---|---|---|
| **Free** | $0 | 100k | 2 | 7 days | hard cap at quota |
| **Pro** | $49/mo | 2M | 10 | 90 days | $0.50 / 1k events |
| **Team** | $199/mo | 10M | 50 | 1 year | $0.30 / 1k events |
| **Enterprise** | Custom | Unlimited | Unlimited | 2 years+ | Custom |

Paid plans include a 14-day trial. SDKs are free and open source.

---

## Repository layout

```
apps/web            Next.js dashboard + REST API
packages/           SDKs & tools (see the ecosystem table)
tinybird/           Tinybird datasources + pipes (the analytics layer)
supabase/           Postgres migrations (metadata + RLS)
docs/               Architecture, frontend roadmap, PRDs
```

### Local development

```bash
pnpm install
pnpm --filter web dev          # dashboard → localhost:3000

# Tinybird (analytics)
cd tinybird && tb --cloud deploy

# SDKs
cd packages/typescript-sdk && pnpm build && pnpm test
cd packages/python-sdk     && pip install -e ".[dev]" && pytest
```

See [CLAUDE.md](CLAUDE.md) for the full architecture, pipe list, and conventions.

---

## Publishing the SDKs

Releases are tag-triggered GitHub Actions:

```bash
git tag typescript-sdk/v0.5.1 && git push origin typescript-sdk/v0.5.1   # → npm
git tag python-sdk/v0.4.1     && git push origin python-sdk/v0.4.1       # → PyPI
```

npm tags: `typescript-sdk/v*`, `mcp-sdk/v*`, `enforce/v*`, `aws-helpers/v*`, `langchain-ts/v*`,
`mcp-proxy/v*` (uses the `NPM_TOKEN` secret). PyPI: `python-sdk/v*` (uses `PYPI_API_TOKEN`).

> **Pricing tables are mirrored** between `apps/web/lib/pricing/table.ts` and
> `packages/python-sdk/prism/_pricing.py` — update both when adding a model.

---

## License

MIT — see [LICENSE](LICENSE). The hosted dashboard at [useprism.dev](https://useprism.dev) is a
commercial product; the SDK packages and this repository are open source.
