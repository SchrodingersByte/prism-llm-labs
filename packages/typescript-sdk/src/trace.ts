import { AsyncLocalStorage } from "async_hooks";
import { detectGitContext } from "./git";

export interface TraceContext {
  traceId:      string;
  spanId:       string;
  parentSpanId: string;
  name:         string;
  /** Structured metadata serialized to the `attributes` Tinybird column. */
  attributes:   Record<string, unknown>;
}

export interface TraceOpts {
  traceId?:             string;
  /** Vector DB or external resource tag, e.g. "pinecone:my-index". Feeds infra_cost_breakdown. */
  downstream_resource?: string;
  /** GL cost-center code, e.g. "ENGR-001". Enables FinOps chargeback queries. */
  cost_center_code?:    string;
  /** Arbitrary structured metadata merged into attributes (lower priority than named fields). */
  attributes?:          Record<string, unknown>;
}

const _storage = new AsyncLocalStorage<TraceContext>();

function newHexId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

// Computed once per process: git context + PRISM_ENVIRONMENT/PRISM_PROJECT env vars.
// Mirrors what EventTracker already does at constructor time via detectGitContext().
// CI env vars (GITHUB_REF_NAME, GITHUB_SHA, etc.) take precedence over subprocess git.
let _devCtx: Record<string, unknown> | null = null;
function getDevCtx(): Record<string, unknown> {
  if (!_devCtx) {
    const git = detectGitContext() as Record<string, unknown>;
    _devCtx = { ...git };
    if (process.env["PRISM_ENVIRONMENT"]) _devCtx["prism_environment"] = process.env["PRISM_ENVIRONMENT"];
    if (process.env["PRISM_PROJECT"])     _devCtx["prism_project"]     = process.env["PRISM_PROJECT"];
  }
  return _devCtx;
}

function buildAttributes(opts: TraceOpts | undefined): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    ...getDevCtx(),
    ...opts?.attributes,
  };
  if (opts?.downstream_resource) attrs["downstream_resource"] = opts.downstream_resource;
  if (opts?.cost_center_code)    attrs["cost_center_code"]    = opts.cost_center_code;
  return attrs;
}

/**
 * Wrap an async function in a Prism trace span.
 *
 * All LLM calls made inside fn() automatically inherit the trace_id and
 * parent_span_id, enabling a full hierarchical call tree in the Trace Explorer.
 *
 * @example
 * const result = await trace("vector-search", async (ctx) => {
 *   return await pinecone.query({ ... });
 * }, { downstream_resource: "pinecone:product-index", cost_center_code: "ENGR-001" });
 */
export function trace<T>(
  name: string,
  fn: (ctx: TraceContext) => Promise<T>,
  opts?: TraceOpts,
): Promise<T> {
  const parent = _storage.getStore();
  const ctx: TraceContext = {
    traceId:      opts?.traceId ?? parent?.traceId ?? newHexId(),
    spanId:       newHexId(),
    parentSpanId: parent?.spanId ?? "",
    name,
    attributes:   buildAttributes(opts),
  };
  return _storage.run(ctx, () => fn(ctx));
}

/**
 * Wrap an async generator (streaming) in a Prism trace span.
 *
 * @example
 * const stream = traceStream("stream-reply", (ctx) =>
 *   openai.chat.completions.create({ stream: true, ... })
 * );
 * for await (const chunk of stream) { ... }
 */
export function traceStream<T>(
  name: string,
  fn: (ctx: TraceContext) => AsyncGenerator<T>,
  opts?: TraceOpts,
): AsyncGenerator<T> {
  const parent = _storage.getStore();
  const ctx: TraceContext = {
    traceId:      opts?.traceId ?? parent?.traceId ?? newHexId(),
    spanId:       newHexId(),
    parentSpanId: parent?.spanId ?? "",
    name,
    attributes:   buildAttributes(opts),
  };
  // Create the generator synchronously inside the ALS context so that
  // all awaits within the generator body inherit the correct trace context.
  let gen!: AsyncGenerator<T>;
  _storage.run(ctx, () => { gen = fn(ctx); });
  return gen;
}

/** Returns the current trace context, or undefined if not inside a trace() call. */
export function getCurrentTrace(): TraceContext | undefined {
  return _storage.getStore();
}
