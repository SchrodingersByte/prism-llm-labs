/**
 * E2E teardown — removes all Supabase rows for the test org
 * and triggers a Tinybird data reset via /api/test/reset.
 *
 * Run with: npx ts-node --project scripts/e2e/tsconfig.json scripts/e2e/teardown.ts
 */

import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

require("dotenv").config({ path: ".env.e2e" });

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const PRISM_TEST_SECRET    = process.env.PRISM_TEST_SECRET!;

interface Seed {
  orgId:     string;
  userId:    string;
  appUrl:    string;
}

async function run() {
  if (!fs.existsSync(".e2e-seed.json")) {
    console.warn("[teardown] .e2e-seed.json not found — nothing to clean up");
    return;
  }

  const seed: Seed = JSON.parse(fs.readFileSync(".e2e-seed.json", "utf-8"));
  const { orgId, userId, appUrl } = seed;
  console.log(`[teardown] Cleaning up org: ${orgId}`);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Delete in dependency order (children before parents)
  // Tables with org_id column (bulk delete by org)
  const orgTables = [
    "key_caps",
    "alert_rules",
    "api_keys",
    "provider_keys",
    "budgets",
    "projects",
    "ingest_log",
    "audit_log",
    "members",
  ];

  for (const table of orgTables) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any).from(table).delete().eq("org_id", orgId);
    if (error && error.code !== "PGRST116") {
      console.warn(`[teardown] ${table} delete warning:`, error.message);
    } else {
      console.log(`[teardown] cleared ${table}`);
    }
  }

  // organizations uses id not org_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: orgErr } = await (admin as any).from("organizations").delete().eq("id", orgId);
  if (orgErr) console.warn("[teardown] organizations delete warning:", orgErr.message);
  else console.log("[teardown] cleared organizations");

  // Delete user from auth
  const { error: userErr } = await admin.auth.admin.deleteUser(userId);
  if (userErr) {
    console.warn("[teardown] auth user delete warning:", userErr.message);
  } else {
    console.log(`[teardown] deleted auth user ${userId}`);
  }

  // Reset Tinybird data for this org
  if (PRISM_TEST_SECRET) {
    try {
      const res = await fetch(`${appUrl}/api/test/reset`, {
        method:  "POST",
        headers: {
          "x-prism-test-secret": PRISM_TEST_SECRET,
          "Content-Type":        "application/json",
        },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (res.ok) {
        console.log("[teardown] Tinybird data reset OK");
      } else {
        const text = await res.text();
        console.warn("[teardown] Tinybird reset failed:", res.status, text);
      }
    } catch (err) {
      console.warn("[teardown] Tinybird reset request failed:", err);
    }
  } else {
    console.warn("[teardown] PRISM_TEST_SECRET not set — Tinybird data NOT cleared");
  }

  fs.unlinkSync(".e2e-seed.json");
  console.log("[teardown] Done — .e2e-seed.json removed");
}

run().catch((err) => {
  console.error("[teardown] Fatal:", err);
  process.exit(1);
});
