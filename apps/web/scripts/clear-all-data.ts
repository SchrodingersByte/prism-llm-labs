/**
 * clear-all-data.ts
 *
 * Wipes all data across Supabase, Tinybird, and Upstash Redis.
 * Leaves the auth.users table untouched — the caller will delete users manually.
 *
 * Usage:
 *   cd apps/web
 *   node --env-file=.env.local node_modules/tsx/dist/cli.cjs scripts/clear-all-data.ts
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TB_URL       = process.env.TINYBIRD_API_URL!;
const TB_TOKEN     = process.env.TINYBIRD_ADMIN_TOKEN!;
const REDIS_URL    = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN  = process.env.UPSTASH_REDIS_REST_TOKEN;

// ── Supabase helpers ──────────────────────────────────────────────────────────

async function deleteAll(table: string, filter: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method:  "DELETE",
    headers: {
      apikey:        SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Prefer:        "return=minimal,count=exact",
    },
  });
  if (res.ok || res.status === 404) {
    const cr = res.headers.get("content-range") ?? "";
    const deleted = parseInt(cr.split("/")[0] ?? "0") || 0;
    console.log(`  ✓ ${table.padEnd(28)} ${deleted > 0 ? deleted + " rows deleted" : "already empty"}`);
    return deleted;
  }
  const txt = await res.text();
  // 400 with "no rows" means table was already empty
  if (txt.includes("0 rows")) {
    console.log(`  ✓ ${table.padEnd(28)} already empty`);
    return 0;
  }
  console.error(`  ✗ ${table}: ${res.status} ${txt.slice(0, 120)}`);
  return 0;
}

// ── Tinybird helpers ──────────────────────────────────────────────────────────

async function truncateDatasource(ds: string): Promise<void> {
  // Try the truncate endpoint first (cleanest)
  const res = await fetch(`${TB_URL}/v0/datasources/${encodeURIComponent(ds)}/truncate`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${TB_TOKEN}` },
  });

  if (res.ok) {
    console.log(`  ✓ ${ds.padEnd(20)} truncated`);
    return;
  }

  // Fallback: ALTER TABLE DELETE mutation
  const sql = `ALTER TABLE \`${ds}\` DELETE WHERE 1=1`;
  const res2 = await fetch(`${TB_URL}/v0/sql?q=${encodeURIComponent(sql)}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${TB_TOKEN}` },
  });

  if (res2.ok) {
    console.log(`  ✓ ${ds.padEnd(20)} deleted via mutation`);
  } else {
    const txt = await res2.text();
    // If the table doesn't exist, that's fine
    if (txt.includes("doesn't exist") || txt.includes("UNKNOWN_TABLE")) {
      console.log(`  ~ ${ds.padEnd(20)} doesn't exist, skipping`);
    } else {
      console.error(`  ✗ ${ds}: ${res2.status} ${txt.slice(0, 120)}`);
    }
  }
}

// ── Redis helper ──────────────────────────────────────────────────────────────

async function flushRedis(): Promise<void> {
  if (!REDIS_URL || !REDIS_TOKEN) {
    console.log("  ~ Redis: credentials not set, skipping");
    return;
  }
  const res = await fetch(`${REDIS_URL}/flushdb`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (res.ok) {
    const j = await res.json() as { result?: string };
    console.log(`  ✓ Redis FLUSHDB: ${j.result ?? "ok"}`);
  } else {
    const txt = await res.text();
    console.error(`  ✗ Redis: ${res.status} ${txt.slice(0, 80)}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n◈ Prism — full data reset\n");
  console.log("This will wipe ALL data across Supabase, Tinybird, and Redis.");
  console.log("auth.users is left intact — delete users manually in Supabase Auth.\n");

  // ── 1. Supabase — delete in reverse FK order ───────────────────────────────
  console.log("── Supabase ─────────────────────────────────────────────────────");

  // Leaf tables first (no inbound FKs from app tables)
  await deleteAll("sdk_bypass_events",      "id=not.is.null");
  await deleteAll("team_members",           "id=not.is.null");
  await deleteAll("key_provider_links",     "api_key_id=not.is.null");
  await deleteAll("github_repo_branches",   "id=not.is.null");
  await deleteAll("project_github_repos",   "id=not.is.null");
  await deleteAll("github_connections",     "id=not.is.null");
  await deleteAll("alert_rules",            "id=not.is.null");
  await deleteAll("budgets",                "id=not.is.null");
  await deleteAll("model_routing_rules",    "id=not.is.null");
  await deleteAll("ingest_log",             "id=not.is.null");
  await deleteAll("notifications",          "id=not.is.null");
  await deleteAll("pending_invites",        "id=not.is.null");

  // Keys before projects/orgs
  await deleteAll("api_keys",               "id=not.is.null");
  await deleteAll("provider_keys",          "id=not.is.null");

  // Teams before orgs (team_members already cleared)
  await deleteAll("teams",                  "id=not.is.null");

  // Projects before orgs
  await deleteAll("projects",               "id=not.is.null");

  // Members before orgs
  await deleteAll("members",                "id=not.is.null");

  // Orgs last
  await deleteAll("organizations",          "id=not.is.null");

  // ── 2. Tinybird — truncate all datasources ─────────────────────────────────
  console.log("\n── Tinybird ─────────────────────────────────────────────────────");
  await truncateDatasource("llm_events_v2");
  await truncateDatasource("mcp_tool_events");
  await truncateDatasource("llm_events");
  await truncateDatasource("erased_events");

  // ── 3. Redis — flush everything ────────────────────────────────────────────
  console.log("\n── Redis (Upstash) ──────────────────────────────────────────────");
  await flushRedis();

  console.log("\n✓ All data cleared.\n");
  console.log("Next steps:");
  console.log("  1. Go to Supabase → Authentication → Users → delete all users");
  console.log("  2. Sign up again as a fresh user");
  console.log("  3. Run seed scripts if you want demo data again");
}

main().catch((err) => {
  console.error("\n✗ Clear failed:", err);
  process.exit(1);
});
