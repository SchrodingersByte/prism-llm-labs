/**
 * E2E verify — queries Tinybird pipes directly and asserts non-zero counts
 * for all dashboard features. Retries with backoff to handle ingestion lag.
 *
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/verify.ts
 */

require("dotenv").config({ path: ".env.e2e" });

import * as fs from "fs";

interface Seed {
  orgId:    string;
}

const TINYBIRD_URL   = process.env.TINYBIRD_API_URL!;
const TINYBIRD_TOKEN = process.env.TINYBIRD_ADMIN_TOKEN!;

if (!TINYBIRD_URL || !TINYBIRD_TOKEN) {
  console.error("[verify] TINYBIRD_API_URL and TINYBIRD_ADMIN_TOKEN must be set in .env.e2e");
  process.exit(1);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// Query a Tinybird pipe and return the first data row
async function queryPipe(
  pipe:   string,
  params: Record<string, string>,
): Promise<Record<string, unknown>[]> {
  const qs  = new URLSearchParams(params).toString();
  const url = `${TINYBIRD_URL}/v0/pipes/${pipe}.json?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TINYBIRD_TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tinybird ${pipe} error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { data: Record<string, unknown>[] };
  return json.data;
}

// Assert a pipe returns at least one row with a numeric field > 0
async function assertNonZero(
  pipe:         string,
  params:       Record<string, string>,
  field:        string,
  description:  string,
): Promise<void> {
  const maxAttempts = 5;
  const baseDelay   = 3000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const rows = await queryPipe(pipe, params);
      const value = rows[0]?.[field];
      if (typeof value === "number" && value > 0) {
        console.log(`[verify] ✓ ${description} (${field}=${value})`);
        return;
      }
      if (typeof value === "string" && parseFloat(value) > 0) {
        console.log(`[verify] ✓ ${description} (${field}=${value})`);
        return;
      }
      if (attempt < maxAttempts) {
        console.log(`[verify] ⏳ ${description} — ${field}=${value ?? "null"}, retry ${attempt}/${maxAttempts} in ${baseDelay * attempt}ms`);
        await sleep(baseDelay * attempt);
      }
    } catch (err) {
      if (attempt < maxAttempts) {
        console.log(`[verify] ⏳ ${description} — query error, retry ${attempt}/${maxAttempts}: ${(err as Error).message}`);
        await sleep(baseDelay * attempt);
      } else {
        throw err;
      }
    }
  }

  throw new Error(`[verify] ✗ ${description} — ${field} never exceeded 0 after ${maxAttempts} attempts`);
}

async function run() {
  if (!fs.existsSync(".e2e-seed.json")) {
    console.error("[verify] .e2e-seed.json not found — run seed.ts first");
    process.exit(1);
  }

  const { orgId }: Seed = JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));
  console.log(`[verify] Checking Tinybird data for org: ${orgId}`);
  console.log("[verify] Waiting 12s for Tinybird ingestion lag...");
  await sleep(12000);

  const now  = new Date();
  const from = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString().slice(0, 10) + " 00:00:00";
  const to   = now.toISOString().slice(0, 10) + " 23:59:59";
  const base = { org_id: orgId, from_date: from, to_date: to };

  const failures: string[] = [];

  async function check(pipe: string, params: Record<string, string>, field: string, desc: string) {
    try {
      await assertNonZero(pipe, params, field, desc);
    } catch (err) {
      failures.push((err as Error).message);
    }
  }

  // Overview / core metrics
  await check("overview_metrics",    base, "total_requests", "Overview: total_requests");
  await check("overview_metrics",    base, "total_cost_usd", "Overview: total_cost_usd");

  // Models (pipe returns total_cost_usd not cost_usd)
  await check("spend_by_model",      base, "total_cost_usd", "Models: total_cost_usd");

  // FinOps vendors
  await check("spend_by_provider",   base, "total_cost_usd", "FinOps Vendors: total_cost_usd");

  // FinOps cost centers (needs x-prism-cost-center tag)
  await check("spend_by_cost_center", base, "cost_usd",      "FinOps Cost Centers: cost_usd");

  // Unit economics — features
  await check("spend_by_feature",    base, "cost_usd",       "Unit Economics: feature cost_usd");

  // Sessions
  await check("sessions_list",       base, "llm_cost_usd",   "Sessions: llm_cost_usd");

  // MCP tools
  await check("mcp_overview_metrics", base, "total_tool_calls", "MCP Overview: total_tool_calls");
  await check("spend_by_mcp_tool",   base, "total_calls",    "MCP Tools: total_calls");

  // Branch analytics
  await check("spend_by_branch",     base, "cost_usd",       "Branch: cost_usd");

  if (failures.length > 0) {
    console.error(`\n[verify] ${failures.length} assertion(s) failed:`);
    for (const f of failures) console.error(`  ${f}`);
    process.exit(1);
  }

  console.log("\n[verify] All assertions passed — Tinybird populated correctly");
}

run().catch((err) => {
  console.error("[verify] Fatal:", err);
  process.exit(1);
});
