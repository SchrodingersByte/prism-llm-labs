#!/usr/bin/env node
/**
 * Apply SQL to the Supabase dev database via the Management API.
 *
 * Usage:
 *   node scripts/db/run-sql.mjs --file supabase/migrations/<name>.sql
 *   node scripts/db/run-sql.mjs --file scripts/db/_verify.sql
 *
 * Reads SUPABASE_ACCESS_TOKEN + project ref from apps/web/.env.local.
 * Does NOT print secrets. Exits non-zero on HTTP/SQL error.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(here, "../../apps/web/.env.local");

function loadEnv(path) {
  const env = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

const env = loadEnv(ENV_PATH);
const token = env.SUPABASE_ACCESS_TOKEN;
const ref = (env.NEXT_PUBLIC_SUPABASE_URL || "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];

if (!token || !ref) {
  console.error("Missing SUPABASE_ACCESS_TOKEN or could not derive project ref from NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
if (fileIdx === -1 || !args[fileIdx + 1]) {
  console.error("Usage: node scripts/db/run-sql.mjs --file <path-to-sql>");
  process.exit(1);
}
const sqlPath = resolve(process.cwd(), args[fileIdx + 1]);
const sql = readFileSync(sqlPath, "utf8");

const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: sql }),
});

const text = await resp.text();
if (!resp.ok) {
  console.error(`✗ HTTP ${resp.status} applying ${args[fileIdx + 1]}`);
  console.error(text);
  process.exit(1);
}
console.log(`✓ Applied ${args[fileIdx + 1]}`);
console.log(text);
