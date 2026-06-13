/**
 * Built-in tool cost estimates (USD per call).
 * Stored in SDK and used as fallback when no per-org override exists.
 *
 * Costs are approximate and based on provider published pricing.
 * Custom overrides can be set per-org in the `tool_cost_catalog` Supabase table.
 */

export interface ToolCostEntry {
  tool_pattern:    string;   // glob-style match, e.g. "pinecone:*" or "exact_tool_name"
  cost_usd:        number;   // cost per single invocation
  description:     string;
}

export const BUILT_IN_TOOL_COSTS: ToolCostEntry[] = [
  // Vector DBs
  { tool_pattern: "pinecone_query",         cost_usd: 0.000001,  description: "Pinecone query (1 read unit)" },
  { tool_pattern: "pinecone_upsert",        cost_usd: 0.000002,  description: "Pinecone upsert (2 write units)" },
  { tool_pattern: "weaviate_query",         cost_usd: 0.0000008, description: "Weaviate query" },
  { tool_pattern: "qdrant_search",          cost_usd: 0.0000005, description: "Qdrant nearest-neighbour search" },
  // AWS
  { tool_pattern: "lambda_invoke",          cost_usd: 0.0000002, description: "AWS Lambda invocation" },
  { tool_pattern: "s3_get_object",          cost_usd: 0.0000004, description: "S3 GET request" },
  { tool_pattern: "s3_put_object",          cost_usd: 0.000005,  description: "S3 PUT request" },
  { tool_pattern: "dynamodb_get_item",      cost_usd: 0.00000025,description: "DynamoDB GetItem (1 RCU)" },
  { tool_pattern: "dynamodb_put_item",      cost_usd: 0.00000125,description: "DynamoDB PutItem (1 WCU)" },
  // Search / web
  { tool_pattern: "brave_search",           cost_usd: 0.000003,  description: "Brave Search API query" },
  { tool_pattern: "serper_search",          cost_usd: 0.000001,  description: "Serper Google Search query" },
  { tool_pattern: "tavily_search",          cost_usd: 0.000002,  description: "Tavily search + extract" },
  { tool_pattern: "exa_search",             cost_usd: 0.000005,  description: "Exa semantic search" },
  // Databases
  { tool_pattern: "postgres_query",         cost_usd: 0,         description: "Postgres query (self-hosted, $0)" },
  { tool_pattern: "supabase_query",         cost_usd: 0,         description: "Supabase query (compute covered by plan)" },
  { tool_pattern: "mongodb_find",           cost_usd: 0,         description: "MongoDB Atlas (covered by cluster cost)" },
  // Code execution
  { tool_pattern: "e2b_run_code",           cost_usd: 0.000014,  description: "E2B sandbox 1s execution" },
  { tool_pattern: "code_interpreter",       cost_usd: 0.000014,  description: "Code interpreter sandbox" },
  // File / filesystem
  { tool_pattern: "read_file",              cost_usd: 0,         description: "Local file read (free)" },
  { tool_pattern: "write_file",             cost_usd: 0,         description: "Local file write (free)" },
  { tool_pattern: "list_directory",         cost_usd: 0,         description: "Directory listing (free)" },
  // Communication
  { tool_pattern: "send_email",             cost_usd: 0.000001,  description: "Transactional email (Resend/SendGrid)" },
  { tool_pattern: "send_slack_message",     cost_usd: 0,         description: "Slack API message (free)" },
  // Generic fallback
  { tool_pattern: "*",                      cost_usd: 0,         description: "Unknown tool (cost not tracked)" },
];

/**
 * Look up the estimated cost for a tool name.
 * Exact match first, then wildcard fallback.
 */
export function lookupToolCost(toolName: string, overrides: ToolCostEntry[] = []): number {
  const all = [...overrides, ...BUILT_IN_TOOL_COSTS];

  // 1. Exact match
  const exact = all.find((e) => e.tool_pattern === toolName);
  if (exact) return exact.cost_usd;

  // 2. Prefix match (e.g. pattern "pinecone:*" matches "pinecone:query")
  const prefix = all.find((e) =>
    e.tool_pattern.endsWith("*") &&
    toolName.startsWith(e.tool_pattern.slice(0, -1)),
  );
  if (prefix) return prefix.cost_usd;

  // 3. Wildcard fallback
  return all.find((e) => e.tool_pattern === "*")?.cost_usd ?? 0;
}
