/**
 * @prism-llm-labs/enforce
 *
 * Intercepts raw AI provider SDK imports and transparently substitutes
 * Prism-wrapped versions so every LLM call is tracked — even when
 * engineers forget to import from prism directly.
 *
 * Usage (Node.js):
 *   node --require @prism-llm-labs/enforce/register app.js
 *   # or via env var:
 *   NODE_OPTIONS="--require @prism-llm-labs/enforce/register" node app.js
 *
 * Usage (Python):
 *   python -m prism.enforce app.py
 *   # or in sitecustomize.py:
 *   import prism.enforce
 *
 * Modes (PRISM_ENFORCE_MODE env var):
 *   transparent  (default) — silently wraps, zero output
 *   warn                   — wraps + logs warning to stderr
 *   strict                 — throws PrismEnforceError, suitable for CI
 */

export { PrismEnforceError } from "./errors";
export type { EnforceMode, EnforceOptions } from "./types";
