/**
 * Built-in tool cost estimates (USD per call).
 * Mirrors apps/web/lib/pricing/tool-catalog.ts — keep in sync.
 *
 * Pricing basis:
 *   - Filesystem / Git: trivial I/O; estimated at $0.01/1K ops
 *   - GitHub API: free tier 5 000 req/hr; charged via Actions minutes at ~$0.0003/req
 *   - Slack / email: negligible API cost; estimated at overhead cost
 *   - Databases: typical query cost on managed DB (Neon/RDS) per operation
 *   - HTTP / browser: outbound network + optional headless browser compute
 *   - AWS: official published rates (Lambda $0.0000002/req, S3 $0.004/10K GET)
 *   - Search APIs: published per-query pricing
 *   - Code execution: E2B/code_interpreter published rates
 *
 * Prefix wildcards ("github_*") match any tool whose name starts with that prefix.
 * lookupToolCost() tries exact → longest-prefix → 0.
 */

const BUILT_IN: Record<string, number> = {
  // ── Filesystem & local I/O ─────────────────────────────────────────────────
  read_file:                0.00001,
  write_file:               0.00005,
  create_file:              0.00005,
  delete_file:              0.00002,
  list_directory:           0.00001,
  move_file:                0.00002,
  copy_file:                0.00002,
  search_files:             0.00003,
  get_file_info:            0.000005,
  read_multiple_files:      0.00003,

  // ── Git operations ─────────────────────────────────────────────────────────
  git_status:               0.000005,
  git_diff:                 0.00001,
  git_commit:               0.00005,
  git_push:                 0.0002,
  git_pull:                 0.0001,
  git_clone:                0.0005,
  git_log:                  0.00001,
  git_branch:               0.000005,
  git_checkout:             0.00002,
  git_merge:                0.0001,

  // ── GitHub API ────────────────────────────────────────────────────────────
  create_issue:             0.0003,
  update_issue:             0.0003,
  close_issue:              0.0002,
  list_issues:              0.0001,
  get_issue:                0.0001,
  create_pull_request:      0.0003,
  merge_pull_request:       0.0005,
  list_pull_requests:       0.0001,
  search_code:              0.001,
  search_repositories:      0.0005,
  get_file_contents:        0.0001,
  create_or_update_file:    0.0003,
  fork_repository:          0.0005,
  create_repository:        0.0005,
  push_files:               0.0003,
  "github_*":               0.0002,   // wildcard fallback for any github_ prefixed tool

  // ── Communication — Slack ─────────────────────────────────────────────────
  slack_post_message:       0.0001,
  slack_reply_to_thread:    0.0001,
  slack_add_reaction:       0.00005,
  slack_get_channel_info:   0.00005,
  slack_list_channels:      0.00008,
  slack_get_users:          0.0001,
  slack_upload_file:        0.0002,
  "slack_*":                0.00008,

  // ── Communication — email / other ─────────────────────────────────────────
  send_email:               0.001,
  send_slack_message:       0.0001,

  // ── Databases ─────────────────────────────────────────────────────────────
  postgres_query:           0.0005,
  postgres_execute:         0.001,
  postgres_insert:          0.001,
  postgres_update:          0.001,
  postgres_delete:          0.001,
  "postgres_*":             0.0005,
  mysql_query:              0.0005,
  "mysql_*":                0.0005,
  mongodb_find:             0.0002,
  mongodb_insert:           0.0005,
  "mongodb_*":              0.0003,
  redis_get:                0.00005,
  redis_set:                0.0001,
  "redis_*":                0.00008,
  sqlite_query:             0.00005,

  // ── HTTP / REST ───────────────────────────────────────────────────────────
  http_get:                 0.0002,
  http_post:                0.0003,
  http_put:                 0.0003,
  http_delete:              0.0002,
  http_fetch:               0.0002,
  fetch_url:                0.0002,
  make_api_request:         0.0003,
  "http_*":                 0.0002,

  // ── Browser / web automation ──────────────────────────────────────────────
  browser_navigate:         0.002,
  browser_screenshot:       0.003,
  browser_click:            0.001,
  browser_type:             0.001,
  browser_scroll:           0.0005,
  browser_get_text:         0.001,
  browser_fill_form:        0.002,
  browser_wait:             0.0005,
  puppeteer_navigate:       0.002,
  playwright_goto:          0.002,
  "browser_*":              0.002,
  "puppeteer_*":            0.002,
  "playwright_*":           0.002,

  // ── Project management — Jira ─────────────────────────────────────────────
  create_jira_issue:        0.0003,
  update_jira_issue:        0.0003,
  search_jira_issues:       0.0002,
  get_jira_issue:           0.0001,
  add_jira_comment:         0.0002,
  "jira_*":                 0.0002,

  // ── Project management — Linear / Notion / Asana ─────────────────────────
  create_linear_issue:      0.0003,
  "linear_*":               0.0002,
  notion_create_page:       0.0003,
  notion_update_page:       0.0003,
  notion_search:            0.0002,
  "notion_*":               0.0002,
  create_asana_task:        0.0003,
  "asana_*":                0.0002,

  // ── Vector DBs ────────────────────────────────────────────────────────────
  pinecone_query:           0.000001,
  pinecone_upsert:          0.000002,
  weaviate_query:           0.0000008,
  qdrant_search:            0.0000005,
  chroma_query:             0.0000005,

  // ── AWS ───────────────────────────────────────────────────────────────────
  lambda_invoke:            0.0000002,
  s3_get_object:            0.0000004,
  s3_put_object:            0.000005,
  s3_list_objects:          0.000005,
  dynamodb_get_item:        0.00000025,
  dynamodb_put_item:        0.00000125,
  dynamodb_query:           0.00000125,
  sqs_send_message:         0.00000040,
  sns_publish:              0.00000050,
  "aws_*":                  0.000001,

  // ── Search / web ──────────────────────────────────────────────────────────
  brave_search:             0.000003,
  serper_search:            0.000001,
  tavily_search:            0.000002,
  exa_search:               0.000005,
  google_search:            0.000005,
  bing_search:              0.000003,
  duckduckgo_search:        0.000001,
  web_search:               0.000002,

  // ── Code execution ────────────────────────────────────────────────────────
  e2b_run_code:             0.000014,
  code_interpreter:         0.000014,
  bash_execute:             0.001,
  run_command:              0.001,
  run_terminal_command:     0.001,
  docker_run:               0.005,
  docker_exec:              0.002,

  // ── AI / embeddings ───────────────────────────────────────────────────────
  generate_embedding:       0.00001,
  openai_embedding:         0.00001,
};

/**
 * Look up estimated cost for a tool name.
 * Exact match, then prefix match ("pinecone_*"), then 0.
 */
export function lookupToolCost(
  toolName:  string,
  overrides: Record<string, number> = {},
): number {
  const all = { ...BUILT_IN, ...overrides };

  // Exact
  if (toolName in all) return all[toolName]!;

  // Prefix: find the longest matching prefix key ending in "_*" or ":*"
  const prefix = Object.keys(all)
    .filter((k) => k.endsWith("*") && toolName.startsWith(k.slice(0, -1)))
    .sort((a, b) => b.length - a.length)[0];

  return prefix ? (all[prefix] ?? 0) : 0;
}
