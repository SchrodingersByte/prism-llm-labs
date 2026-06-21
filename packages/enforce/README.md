# @prism-llm-labs/enforce

An import hook that **transparently substitutes Prism-wrapped clients for raw AI provider SDKs**,
so every LLM call is tracked — even when an engineer imports `openai` directly instead of
`@prism-llm-labs/sdk`. This is how you guarantee gateway/observability coverage and surface
**Shadow IT** (un-instrumented spend) in the dashboard.

```bash
npm install @prism-llm-labs/enforce
```

> Requires [`@prism-llm-labs/sdk`](../typescript-sdk) (peer dependency).

## Node.js

Preload the register hook — no code changes:

```bash
node --require @prism-llm-labs/enforce/register app.js
# or, without changing the command:
NODE_OPTIONS="--require @prism-llm-labs/enforce/register" node app.js
```

Now `import OpenAI from "openai"` (or `require("openai")`) anywhere in the process resolves to the
Prism-wrapped client automatically.

## Python

```bash
python -m prism.enforce app.py
```

Or enable it process-wide from `sitecustomize.py`:

```python
import prism.enforce   # auto-wraps openai / anthropic / google imports
```

## Modes

Set `PRISM_ENFORCE_MODE`:

| Mode | Behavior |
|---|---|
| `transparent` *(default)* | Silently wraps, zero output |
| `warn` | Wraps **and** logs a warning to stderr for each raw import |
| `strict` | Throws `PrismEnforceError` on a raw import — use in CI to fail the build if a service bypasses Prism |

```bash
PRISM_ENFORCE_MODE=strict node --require @prism-llm-labs/enforce/register app.js
```

## Programmatic

```typescript
import { PrismEnforceError } from "@prism-llm-labs/enforce";
import type { EnforceMode, EnforceOptions } from "@prism-llm-labs/enforce";
```

`PRISM_API_KEY` (and the usual `PRISM_PROJECT` / `PRISM_ENVIRONMENT` / `PRISM_SERVICE_NAME`)
configure attribution, exactly as with the base SDK. `PRISM_SERVICE_NAME` is what lights up the
Shadow-IT / gateway-coverage views.

## Requirements

Node ≥ 18 · `@prism-llm-labs/sdk >= 0.1.0`.
