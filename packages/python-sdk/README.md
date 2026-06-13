# prism-llm-labs

LLM cost and usage observability for Python. Drop-in replacements for the OpenAI, Anthropic, and Google Generative AI clients that send telemetry to your [Prism](https://useprism.dev) dashboard in the background — zero latency impact.

## Install

```bash
pip install prism-llm-labs
```

## Quick start — OpenAI

```python
from prism import OpenAI

client = OpenAI(
    api_key="sk-...",            # your OpenAI key
    prism_key="prism_live_...", # your Prism API key (from dashboard → API Keys)
    project="my-app",            # groups usage in the dashboard
    environment="production",
)

# Use exactly like openai.OpenAI — no other changes needed
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

Every call automatically captures: model, input/output/cached tokens, cost in USD, latency, status code, and request ID — shipped to Tinybird asynchronously in a daemon thread.

## Async usage

```python
from prism import AsyncOpenAI

client = AsyncOpenAI(
    api_key="sk-...",
    prism_key="prism_live_...",
    project="my-app",
)

response = await client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Anthropic

```python
from prism import PrismAnthropic

client = PrismAnthropic(
    api_key="sk-ant-...",
    prism_key="prism_live_...",
    project="my-app",
)

response = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello"}],
)
```

## Google Gemini

```python
from prism import PrismGoogleAI

client = PrismGoogleAI(
    api_key="AIza...",
    prism_key="prism_live_...",
    project="my-app",
)

model = client.GenerativeModel("gemini-1.5-pro")
response = model.generate_content("Explain quantum computing")
print(response.text)
```

## Gateway mode

Gateway mode routes your LLM traffic through Prism's cloud proxy. This enables:
- **Streaming analytics** — Prism tees the SSE stream and captures usage from the final chunk
- **Provider key vault** — no provider API key needed in your app; Prism decrypts it server-side
- **Zero patching** — the underlying SDK calls the Prism proxy directly

```python
from prism import OpenAI

client = OpenAI(
    prism_key="prism_live_...",
    project="my-app",
    mode="gateway",
    # PRISM_APP_URL defaults to https://useprism.dev
)

# Streaming now tracked automatically in gateway mode
stream = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

## Budget enforcement

If a hard budget cap is set for your project in the Prism dashboard, the SDK checks current spend before each call and raises `BudgetExceededError` if the limit is reached:

```python
from prism import OpenAI
from prism._budget import BudgetExceededError

client = OpenAI(prism_key="prism_live_...", project="my-app")

try:
    response = client.chat.completions.create(...)
except BudgetExceededError as e:
    print(f"Budget exceeded: {e}")
```

Budget checks are fast (<2 ms) HTTP calls to Upstash Redis — they never hit the LLM provider.

## Streaming

**In SDK (direct) mode**, streaming calls are **not tracked**. When `stream=True` is passed, the OpenAI SDK returns a `Stream` iterator — usage data is only in the final chunk, which is consumed by your code outside Prism's control. Prism skips these calls to avoid recording zero-token events that corrupt cost dashboards.

**Use gateway mode for streaming analytics.** Prism's proxy tees the SSE stream server-side and captures usage from the final chunk automatically.

```python
# SDK mode — streaming NOT tracked
client = OpenAI(prism_key="prism_live_...", project="my-app")
stream = client.chat.completions.create(model="gpt-4o", messages=[...], stream=True)

# Gateway mode — streaming IS tracked
client = OpenAI(prism_key="prism_live_...", project="my-app", mode="gateway")
stream = client.chat.completions.create(model="gpt-4o", messages=[...], stream=True)
```

## Configuration

### Constructor arguments

| Argument | Type | Description |
|---|---|---|
| `prism_key` | `str` | Your Prism API key. Falls back to `PRISM_API_KEY` env var |
| `project` | `str` | Project name shown in the dashboard. Falls back to `PRISM_PROJECT` |
| `team` | `str` | Team identifier for per-member cost attribution. Falls back to `PRISM_TEAM` |
| `environment` | `str` | `production` / `staging` / `development`. Falls back to `PRISM_ENVIRONMENT` |
| `mode` | `str` | `"sdk"` (default) patches the client; `"gateway"` routes via Prism proxy |

All other arguments are passed through to the underlying provider SDK unchanged.

### Environment variables

```bash
PRISM_API_KEY=prism_live_...          # your Prism API key
PRISM_PROJECT=my-project              # project name
PRISM_TEAM=backend-team               # team identifier (optional)
PRISM_ENVIRONMENT=production          # environment tag (default: production)
PRISM_APP_URL=https://useprism.dev    # gateway mode proxy URL (default: useprism.dev)
```

### Global configuration

```python
from prism import configure

# Override the Tinybird ingest URL (for US region Tinybird workspace)
configure(ingest_url="https://api.us-east.tinybird.co/v0/events?name=llm_events")
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

Telemetry is sent in a background daemon thread — if it fails, a warning is emitted but your app continues unaffected.

## Requirements

- Python ≥ 3.9
- `openai >= 1.0.0` (for `OpenAI` / `AsyncOpenAI`)
- `anthropic >= 0.20.0` (for `PrismAnthropic`)
- `google-generativeai >= 0.5.0` (for `PrismGoogleAI`)
- `httpx >= 0.25.0`
- `pydantic >= 2.0`
