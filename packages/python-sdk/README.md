# prism-llm-labs

LLM cost, usage, and quality observability for Python. Drop-in replacements for the **OpenAI**,
**Anthropic**, and **Google Generative AI** clients that ship telemetry to your
[Prism](https://useprism.dev) dashboard in the background — zero latency impact — plus helpers
for tracing, CI evals, end-user feedback, a managed prompt registry, and MCP tool tracking.

```bash
pip install prism-llm-labs
# extras: pip install "prism-llm-labs[anthropic]"  ·  [google]  ·  [langchain]  ·  [mcp]  ·  [all]
```

## Contents
- [Quick start](#quick-start) · [Gateway mode](#gateway-mode) · [Budgets](#budget-enforcement) · [Streaming](#streaming)
- [Attribution & tags](#attribution--tags) · [Tracing](#tracing) · [CI evals](#ci-evals) · [Feedback](#end-user-feedback)
- [Prompt registry](#prompt-registry) · [MCP tools](#mcp-tool-tracking) · [Configuration](#configuration)

---

## Quick start

```python
from prism import OpenAI

client = OpenAI(
    api_key="sk-...",            # your OpenAI key
    prism_key="prism_live_...",  # dashboard → Settings → Access → API Keys
    project="my-app",
    environment="production",
)

# Identical to openai.OpenAI — no other changes needed
res = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

Every call captures model, input/output/cached tokens, cost (USD), latency, status code, and
request ID — shipped asynchronously in a daemon thread.

### Async

```python
from prism import AsyncOpenAI

client = AsyncOpenAI(prism_key="prism_live_...", project="my-app")
res = await client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "Hi"}])
```

### Anthropic & Google

```python
from prism import PrismAnthropic, PrismGoogleAI   # pip install "prism-llm-labs[anthropic]" / [google]

claude = PrismAnthropic(prism_key="prism_live_...", project="my-app")
claude.messages.create(model="claude-3-5-sonnet-20241022", max_tokens=1024,
                       messages=[{"role": "user", "content": "Hello"}])

gem = PrismGoogleAI(prism_key="prism_live_...", project="my-app")
gem.GenerativeModel("gemini-1.5-pro").generate_content("Explain quantum computing")
```

> Canonical names `PrismOpenAI` / `PrismAsyncOpenAI` are exported too; `OpenAI` is kept as a
> drop-in alias.

---

## Gateway mode

Route traffic through Prism's proxy for **streaming analytics**, a **provider-key vault**, and
**zero patching**:

```python
client = OpenAI(prism_key="prism_live_...", project="my-app", mode="gateway")
# or set PRISM_GATEWAY_URL — auto-detected
```

The gateway also enforces model policies, residency, spend caps, fallbacks, and guardrails.

---

## Budget enforcement

If a hard budget cap is set for your project, the SDK checks spend before each call (a fast
~2 ms Upstash Redis check) and raises `BudgetExceededError`:

```python
from prism import OpenAI
from prism._budget import BudgetExceededError

client = OpenAI(prism_key="prism_live_...", project="my-app")
try:
    client.chat.completions.create(...)
except BudgetExceededError:
    ...  # fall back to a cheaper model / cached response
```

## Streaming

**SDK mode does not track streaming calls** (usage is only in the final chunk, consumed in your
code). **Use gateway mode for streaming analytics** — the proxy captures usage automatically.

---

## Attribution & tags

Tag a call's feature / action / cost center with the typed `prism_tags` helper:

```python
from prism import prism_tags

client.chat.completions.create(
    model="gpt-4o",
    messages=messages,
    extra_headers=prism_tags(feature="chat", action="reply", cost_center="eng-product"),
)
```

Auto-tag whole endpoints with the `@prism_feature` decorator or the ASGI middleware:

```python
from prism import prism_feature, PrismMiddleware
from fastapi import FastAPI

app = FastAPI()
app.add_middleware(PrismMiddleware)   # infers feature from the route path (/api/chat → "chat")

@app.post("/api/summarize")
@prism_feature("document-summarization")   # explicit override
async def summarize(body): ...
```

---

## Tracing

Link every LLM call inside a unit of work into one hierarchical trace. Works as a **decorator**
or an **async/sync context manager**, and accepts FinOps tags:

```python
from prism import trace

@trace("rag-answer", cost_center_code="ENGR-001")
async def answer(q: str):
    async with trace.span("vector-search", downstream_resource="pinecone:product-index"):
        docs = await retriever.query(q)
    return await client.chat.completions.create(model="gpt-4o", messages=build(docs))
```

`get_current_trace()` reads the active context (also used by `send_feedback`).

---

## CI evals

Gate your pipeline on quality — run a dataset through a subject, score it server-side, and fail
the build on a low score or a regression vs a baseline:

```python
from prism import gate_eval, EvalGateError

gate_eval(
    dataset="DATASET_UUID",            # or items=[{"input": ..., "expected_output": ...}]
    subject={"model": "gpt-4o-mini"},
    scorers=["correctness"],
    threshold=0.8,
    baseline_run_id=os.environ.get("PRISM_BASELINE_RUN_ID"),
)  # raises EvalGateError when it doesn't pass
```

Use `run_eval(...)` to inspect `result.passed` / `result.score_delta` without raising. A console
script **`prism-evals`** runs a JSON config and exits non-zero on failure:

```bash
prism-evals ./prism.eval.json
```

---

## End-user feedback

```python
from prism import send_feedback

send_feedback(value=1, comment="spot on")                    # 👍 on the current trace
send_feedback(value=0, trace_id=tid, feature_tag="support")  # 👎 on a specific trace
```

---

## Prompt registry

Resolve a managed prompt by name + label at runtime — promote a label to ship a change, no
redeploy (cached in-memory with a short TTL):

```python
from prism import get_prompt

p = get_prompt("support-reply", label="production")
messages = p.compile({"customer": "Dana"})   # fills {{customer}}
# stamp p.prompt_version as tags['prompt_version'] so spend/quality attribute to it
```

---

## MCP tool tracking

With the `[mcp]` extra, instrument MCP tool calls — costs, session budgets, and loop limits —
and attribute downstream vector-DB spend:

```python
from prism import PrismMCP   # pip install "prism-llm-labs[mcp]"

prism_mcp = PrismMCP(prism_key="prism_live_...", session_budget_usd=0.50)

async with prism_mcp.wrap_tool("search", downstream_resource="qdrant:docs") as ctx:
    result = await qdrant.search(...)
    # ctx.report_actual_cost(...) to override the catalog estimate
```

For a standalone MCP server, see [`@prism-llm-labs/mcp-sdk`](../mcp-sdk) (TS) and the zero-code
[`@prism-llm-labs/mcp-proxy`](../mcp-proxy) CLI.

---

## Configuration

### Constructor arguments

| Argument | Type | Description |
|---|---|---|
| `prism_key` | `str` | Prism API key. Falls back to `PRISM_API_KEY` |
| `project` | `str` | Project name. Falls back to `PRISM_PROJECT` |
| `team` | `str` | Team identifier. Falls back to `PRISM_TEAM` |
| `environment` | `str` | `production` / `staging` / `development`. Falls back to `PRISM_ENVIRONMENT` |
| `mode` | `str` | `"sdk"` (default) patches the client; `"gateway"` routes via the Prism proxy |

All other arguments pass through to the underlying provider SDK unchanged.

### Environment variables

```bash
PRISM_API_KEY=prism_live_...
PRISM_PROJECT=my-project
PRISM_TEAM=backend-team             # optional
PRISM_ENVIRONMENT=production        # default: production
PRISM_GATEWAY_URL=https://useprism.dev
```

### Global configuration

```python
from prism import configure
configure(ingest_url="https://api.us-east.tinybird.co/v0/events?name=llm_events")
```

---

## What gets tracked

Tokens (input / output / cached), cost (USD), latency, model & provider, project / team /
environment, request ID, and status code. Telemetry runs in a background daemon thread — a
failure emits a warning but never affects your app.

## Requirements

Python ≥ 3.9 · `openai >= 1.0.0` · `httpx` · `pydantic` · optional extras for Anthropic / Google /
LangChain / MCP.
