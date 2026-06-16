/**
 * Prompt registry fetch helper (PRD-4).
 *
 * Resolve a managed prompt by name + label (Langfuse-style) at runtime — so you
 * can ship prompt changes by promoting a label, with no code redeploy. Results
 * are cached in-memory by name+label with a short TTL; promote a label and the
 * next fetch past the TTL picks it up.
 *
 *   import { getPrompt } from "@prism-llm-labs/sdk";
 *   const p = await getPrompt("support-reply", { label: "production" });
 *   const messages = p.compile({ customer: "Dana" });   // fills {{customer}}
 *   // pass p.promptVersion as tags['prompt_version'] so spend/quality attribute to it
 *
 * Server: GET /api/prompts/resolve (authenticated by PRISM_API_KEY).
 */
export interface PromptMessage { role: string; content: string }

export interface ResolvedPrompt {
  name:          string;
  version:       number;
  messages:      PromptMessage[];
  config:        Record<string, unknown>;
  /** "name@version" — stamp as tags['prompt_version'] so attribution flows. */
  promptVersion: string;
  /** Fill {{variable}} placeholders in message contents; returns a new messages array. */
  compile:       (variables?: Record<string, string | number>) => PromptMessage[];
}

export interface GetPromptOptions {
  label?:     string;     // default "production"
  version?:   number;     // pin an explicit version (overrides label)
  projectId?: string;
  apiKey?:    string;     // default process.env.PRISM_API_KEY
  baseUrl?:   string;
  /** Cache TTL in ms (default 60000). Pass 0 to bypass the cache. */
  ttlMs?:     number;
}

interface CacheEntry { value: ResolvedPrompt; expiresAt: number }
const _cache = new Map<string, CacheEntry>();

function resolveBaseUrl(explicit?: string): string {
  const url =
    explicit ??
    process.env["PRISM_GATEWAY_URL"] ??
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev";
  return url.replace(/\/$/, "");
}

function compileMessages(messages: PromptMessage[], variables?: Record<string, string | number>): PromptMessage[] {
  if (!variables) return messages.map(m => ({ ...m }));
  return messages.map(m => ({
    role:    m.role,
    content: m.content.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in variables ? String(variables[k]) : `{{${k}}}`)),
  }));
}

/** Clear the in-memory prompt cache (e.g. in tests, or after a known promote). */
export function clearPromptCache(): void { _cache.clear(); }

export async function getPrompt(name: string, opts: GetPromptOptions = {}): Promise<ResolvedPrompt> {
  const apiKey = opts.apiKey ?? process.env["PRISM_API_KEY"];
  if (!apiKey) throw new Error("Prism getPrompt: missing API key (set PRISM_API_KEY or pass apiKey).");

  const label = opts.label ?? "production";
  const ttl   = opts.ttlMs ?? 60_000;
  const key   = `${name}:${opts.version != null ? `v${opts.version}` : label}:${opts.projectId ?? ""}`;

  if (ttl > 0) {
    const hit = _cache.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  const qs = new URLSearchParams({ name });
  if (opts.version != null) qs.set("version", String(opts.version));
  else qs.set("label", label);
  if (opts.projectId) qs.set("project_id", opts.projectId);

  const res = await fetch(`${resolveBaseUrl(opts.baseUrl)}/api/prompts/resolve?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Prism getPrompt failed (${res.status}): ${String(json.error ?? res.statusText)}`);

  const messages = (Array.isArray(json.content) ? json.content : []) as PromptMessage[];
  const value: ResolvedPrompt = {
    name:          String(json.name ?? name),
    version:       Number(json.version ?? 0),
    messages,
    config:        (json.config as Record<string, unknown>) ?? {},
    promptVersion: String(json.prompt_version ?? `${name}@${json.version ?? 0}`),
    compile:       (variables) => compileMessages(messages, variables),
  };

  if (ttl > 0) _cache.set(key, { value, expiresAt: Date.now() + ttl });
  return value;
}
