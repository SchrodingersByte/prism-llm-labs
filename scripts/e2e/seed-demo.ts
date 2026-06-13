/**
 * Comprehensive demo data seed for the real user org (dip.dey2112@gmail.com).
 *
 * Additive + idempotent — safe to re-run.
 *
 * Phases:
 *   1. Supabase infra  — provider keys, Prism keys, projects, teams, routing, actions, PII config
 *   2. Historical events — ~600 LLM + ~250 MCP + ~60 outcome events via direct Tinybird API
 *   3. Compliance       — PII incidents, enforce checkins, bypass events
 *   4. Training runs    — 5 training jobs in Supabase
 *
 * Usage:
 *   source .env.e2e
 *   ./scripts/e2e/node_modules/.bin/ts-node --project scripts/e2e/tsconfig.json scripts/e2e/seed-demo.ts
 */

require("dotenv").config({ path: ".env.e2e" });

import { seedInfra }        from "./demo/infra";
import { clearOrgEvents, generateLlmEvents, generateMcpEvents, generateOutcomeEvents } from "./demo/events";
import { seedCompliance }   from "./demo/compliance";
import { seedTraining }     from "./demo/training";

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ENCRYPTION_SECRET",
  "TINYBIRD_API_URL",
  "TINYBIRD_ADMIN_TOKEN",
];

async function run() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[seed-demo] Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }

  console.log("\n========================================================");
  console.log(" Prism Demo Data Seed");
  console.log("========================================================\n");

  // ── Phase 1: Supabase infra ───────────────────────────────────────────────
  console.log("--- Phase 1: Supabase infrastructure ---");
  const ctx = await seedInfra();
  console.log(`\n[seed-demo] Org: ${ctx.orgId}`);
  console.log(`[seed-demo] Projects: customer-platform=${ctx.projects.customerPlatform.slice(0, 8)}...`);
  console.log(`[seed-demo] API keys: prod-all-models=${ctx.apiKeys.prodAll.id.slice(0, 8)}...`);

  // ── Phase 2: Historical events ────────────────────────────────────────────
  console.log("\n--- Phase 2: Historical events (Tinybird) ---");
  await clearOrgEvents(ctx.orgId);
  await generateLlmEvents(ctx);
  await generateMcpEvents(ctx);
  await generateOutcomeEvents(ctx);

  // ── Phase 3: Compliance ───────────────────────────────────────────────────
  console.log("\n--- Phase 3: Compliance (PII + Enforce) ---");
  await seedCompliance(ctx);

  // ── Phase 4: Training runs ────────────────────────────────────────────────
  console.log("\n--- Phase 4: Training runs ---");
  await seedTraining(ctx);

  console.log("\n========================================================");
  console.log(" Demo seed complete!");
  console.log("========================================================");
  console.log("\nDashboard pages to check:");
  console.log("  /dashboard                  — KPIs, spend chart");
  console.log("  /dashboard/finops           — Vendor breakdown, budgets, cost centers");
  console.log("  /dashboard/models           — Per-model efficiency table");
  console.log("  /dashboard/unit-economics   — Feature/action analytics, outcome ROI");
  console.log("  /dashboard/agents           — MCP tools, agent loop detection");
  console.log("  /dashboard/sessions         — Session list, P50/P90/P99");
  console.log("  /dashboard/training         — 5 training runs");
  console.log("  /settings/access            — 5 Prism keys, enforce checkins");
  console.log("  /settings/integrations      — 6 provider keys, 4 routing rules");
  console.log("  /settings/compliance        — 8 PII incidents");
  console.log("");
}

run().catch((err) => {
  console.error("\n[seed-demo] Fatal error:", err);
  process.exit(1);
});
