#!/usr/bin/env node
/**
 * Query a Tinybird pipe with arbitrary params (dev smoke-testing).
 *
 * Usage:
 *   node scripts/db/tb-query.mjs <pipe> key=value [key=value ...]
 *   node scripts/db/tb-query.mjs overview_metrics org_id=<uuid> project_ids=<id1>,<id2>
 *
 * Reads TINYBIRD_API_URL + TINYBIRD_ADMIN_TOKEN from apps/web/.env.local.
 * Does NOT print secrets. Prints HTTP status + JSON body.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnv(resolve(here, "../../apps/web/.env.local"));
const BASE = env.TINYBIRD_API_URL;
const TOKEN = env.TINYBIRD_ADMIN_TOKEN;
if (!BASE || !TOKEN) { console.error("Missing TINYBIRD_API_URL or TINYBIRD_ADMIN_TOKEN"); process.exit(1); }

const [pipe, ...pairs] = process.argv.slice(2);
if (!pipe) { console.error("Usage: tb-query.mjs <pipe> key=value ..."); process.exit(1); }

const params = new URLSearchParams();
for (const p of pairs) {
  const i = p.indexOf("=");
  params.set(p.slice(0, i), p.slice(i + 1));
}

const res = await fetch(`${BASE}/v0/pipes/${pipe}.json?${params.toString()}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
});
console.log(`HTTP ${res.status}`);
console.log(await res.text());
