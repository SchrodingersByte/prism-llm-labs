/**
 * Billing sync orchestrator.
 *
 * Loads all active cloud_billing_connections for an org (or all orgs),
 * calls the appropriate billing API client, performs cost attribution,
 * and upserts results into mcp_cost_reconciliation.
 */

import { createClient } from "@supabase/supabase-js";
import { decryptKey }   from "@/lib/crypto/keys";
import { ingestToTinybird } from "@/lib/tinybird/client";
import { getCostsByService, getCostsByTag, type AWSCredentials } from "./aws";
import { getPineconeDetailRows } from "./pinecone";
import { getQdrantCollectionRows, getQdrantUsage } from "./qdrant";
import { getWeaviateClassRows } from "./weaviate";
import { getGcpCostRows }      from "./gcp";
import { getMilvusCollectionRows } from "./milvus";

// ── Types ──────────────────────────────────────────────────────────────────────

interface BillingConnection {
  id:                   string;
  org_id:               string;
  provider:             string;
  display_name:         string;
  credentials_encrypted: string;
  config:               Record<string, unknown>;
  attribution_mode:     string;
}

interface SyncResult {
  connection_id:  string;
  provider:       string;
  org_id:         string;
  total_cost_usd: number;
  records_written: number;
  error?:         string;
}

// ── Main orchestrator ──────────────────────────────────────────────────────────

export async function syncAllConnections(
  orgId?: string,  // if provided, sync only this org; otherwise sync all
): Promise<SyncResult[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Load active connections
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("cloud_billing_connections")
    .select("id, org_id, provider, display_name, credentials_encrypted, config, attribution_mode")
    .eq("is_active", true);

  if (orgId) query = query.eq("org_id", orgId);

  const { data: connections } = await query as { data: BillingConnection[] | null };
  if (!connections?.length) return [];

  const results: SyncResult[] = [];

  // Yesterday's date range (billing APIs have ~24h delay)
  const yesterday = new Date(Date.now() - 86_400_000);
  const fromDate  = yesterday.toISOString().slice(0, 10);
  const toDate    = new Date().toISOString().slice(0, 10);

  for (const conn of connections) {
    try {
      const result = await syncConnection(supabase, conn, fromDate, toDate);
      results.push(result);

      // Update last_synced_at and status
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("cloud_billing_connections")
        .update({
          last_synced_at:   new Date().toISOString(),
          last_sync_status: result.error ?? "ok",
          last_sync_cost_usd: result.total_cost_usd,
        })
        .eq("id", conn.id);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        connection_id:   conn.id,
        provider:        conn.provider,
        org_id:          conn.org_id,
        total_cost_usd:  0,
        records_written: 0,
        error:           errMsg,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from("cloud_billing_connections")
        .update({ last_synced_at: new Date().toISOString(), last_sync_status: `error: ${errMsg}` })
        .eq("id", conn.id);
    }
  }

  void emitBillingRecordsToTinybird(results, connections ?? [], fromDate).catch(() => {});
  return results;
}

async function emitBillingRecordsToTinybird(
  results:     SyncResult[],
  connections: BillingConnection[],
  fromDate:    string,
): Promise<void> {
  const connMap = new Map(connections.map(c => [c.id, c]));
  const events  = results
    .filter(r => !r.error && r.records_written > 0)
    .map(r => ({
      event_id:        `${r.provider}-${r.org_id}-${fromDate}-${Date.now()}`,
      org_id:          r.org_id,
      timestamp:       `${fromDate} 00:00:00`,
      provider:        r.provider,
      resource_name:   connMap.get(r.connection_id)?.display_name ?? "",
      operation_type:  "sync",
      session_id:      "",
      environment:     (connMap.get(r.connection_id)?.config?.["environment"] as string | undefined) ?? "",
      actual_cost_usd: r.total_cost_usd,
      cost_source:     r.provider,
      synced_at:       new Date().toISOString().replace("T", " ").slice(0, 23),
    }));

  if (events.length > 0) {
    await ingestToTinybird(events, "actual_billing_records");
  }
}

// ── Per-connection sync ────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncConnection(supabase: any, conn: BillingConnection, fromDate: string, toDate: string): Promise<SyncResult> {
  const creds = JSON.parse(decryptKey(conn.credentials_encrypted)) as Record<string, string>;

  switch (conn.provider) {
    case "aws":      return syncAWS(supabase, conn, creds as unknown as AWSCredentials, fromDate, toDate);
    case "pinecone": return syncPinecone(supabase, conn, creds["api_key"]!, fromDate, toDate);
    case "qdrant":   return syncQdrant(supabase, conn, creds["api_key"]!, creds["cluster_url"]!, fromDate, toDate);
    case "weaviate": return syncWeaviate(supabase, conn, creds["api_key"]!, creds["cluster_url"]!);
    case "azure":    return syncAzure(supabase, conn, creds, fromDate, toDate);
    case "gcp":      return syncGcp(supabase, conn, creds, fromDate, toDate);
    case "milvus":   return syncMilvus(supabase, conn, creds["api_key"]!, creds["cluster_url"]!);
    default:
      return { connection_id: conn.id, provider: conn.provider, org_id: conn.org_id, total_cost_usd: 0, records_written: 0, error: `unsupported provider: ${conn.provider}` };
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncAWS(supabase: any, conn: BillingConnection, creds: AWSCredentials, fromDate: string, toDate: string): Promise<SyncResult> {
  const tagKey = (conn.config["tag_key"] as string | undefined) ?? "prism-session-id";

  if (conn.attribution_mode === "tag_based") {
    // tag-based: fetch session IDs from mcp_tool_events and look each one up
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: sessions } = await (supabase as any)
      .from("mcp_tool_events")
      // We don't have a direct sessions view in Supabase — query via Tinybird instead
      // For now: use the sessions from mcp_cost_reconciliation as seed
      .select("session_id")
      .eq("org_id", conn.org_id)
      .gte("timestamp", fromDate)
      .limit(500) as { data: { session_id: string }[] | null };

    const uniqueSessions = Array.from(new Set((sessions ?? []).map(r => r.session_id)));
    let totalWritten = 0;
    let totalCost = 0;

    for (const sessionId of uniqueSessions) {
      const cost = await getCostsByTag(creds, tagKey, sessionId, fromDate, toDate);
      if (cost > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("mcp_cost_reconciliation").upsert({
          org_id:         conn.org_id,
          event_id:       `aws-session-${sessionId}-${fromDate}`,
          session_id:     sessionId,
          estimated_cost: 0,
          actual_cost:    cost,
          cost_source:    "aws_cost_explorer",
        }, { onConflict: "org_id,event_id" });
        totalWritten++;
        totalCost += cost;
      }
    }
    return { connection_id: conn.id, provider: "aws", org_id: conn.org_id, total_cost_usd: totalCost, records_written: totalWritten };
  }

  // Proportional mode: get total service costs, distribute across sessions
  const services = (conn.config["services"] as string[] | undefined) ?? ["AWS Lambda", "Amazon DynamoDB", "Amazon S3"];
  const costs    = await getCostsByService(creds, fromDate, toDate);
  const relevant = costs.filter(c => services.some(s => c.service.includes(s)));
  const totalCost = relevant.reduce((s, c) => s + c.amountUsd, 0);

  if (totalCost === 0) return { connection_id: conn.id, provider: "aws", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  return distributeProportionally(supabase, conn, totalCost, "aws_cost_explorer", fromDate, toDate);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncPinecone(supabase: any, conn: BillingConnection, apiKey: string, fromDate: string, toDate: string): Promise<SyncResult> {
  const indexFilter = conn.config["indexes"] as string[] | undefined;
  const environment = conn.config["environment"] as string | undefined;
  const rows        = await getPineconeDetailRows(apiKey, fromDate, toDate, indexFilter);
  const totalCost   = rows.reduce((s, r) => s + r.totalCostUsd, 0);

  if (totalCost === 0) return { connection_id: conn.id, provider: "pinecone", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  let written = 0;
  // Store three rows per index: read, write, storage — with resource_name + operation_type
  for (const row of rows) {
    const base = {
      org_id:        conn.org_id,
      session_id:    "",
      estimated_cost: 0,
      cost_source:   "pinecone_usage_api",
      resource_name: `pinecone:${row.indexName}`,
      environment:   environment ?? null,
    };
    const perOp = [
      { event_id: `pinecone-${row.indexName}-read-${fromDate}`,    actual_cost: row.readCostUsd,    operation_type: "read" },
      { event_id: `pinecone-${row.indexName}-write-${fromDate}`,   actual_cost: row.writeCostUsd,   operation_type: "write" },
      { event_id: `pinecone-${row.indexName}-storage-${fromDate}`, actual_cost: row.storageCostUsd, operation_type: "storage" },
    ];
    for (const op of perOp) {
      if (op.actual_cost === 0) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from("mcp_cost_reconciliation").upsert(
        { ...base, ...op },
        { onConflict: "org_id,event_id" },
      );
      written++;
    }
  }

  return { connection_id: conn.id, provider: "pinecone", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncQdrant(supabase: any, conn: BillingConnection, apiKey: string, clusterUrl: string, fromDate: string, toDate: string): Promise<SyncResult> {
  const collectionFilter = conn.config["collections"] as string[] | undefined;
  const environment      = conn.config["environment"] as string | undefined;
  const collRows         = await getQdrantCollectionRows(apiKey, clusterUrl, collectionFilter);

  if (!collRows.length) {
    // Fallback to aggregate usage
    const usage = await getQdrantUsage(apiKey, clusterUrl, fromDate, toDate);
    if (usage.costUsd === 0) return { connection_id: conn.id, provider: "qdrant", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };
    return distributeProportionally(supabase, conn, usage.costUsd, "qdrant_billing_api", fromDate, toDate);
  }

  const totalCost = collRows.reduce((s, r) => s + r.costUsd, 0);
  let written = 0;

  for (const col of collRows) {
    if (col.costUsd === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert(
      {
        org_id:         conn.org_id,
        event_id:       `qdrant-${col.collectionName}-request-${fromDate}`,
        session_id:     "",
        estimated_cost: 0,
        actual_cost:    col.costUsd,
        cost_source:    "qdrant_billing_api",
        resource_name:  `qdrant:${col.collectionName}`,
        operation_type: "request",
        environment:    environment ?? null,
      },
      { onConflict: "org_id,event_id" },
    );
    written++;
  }

  return { connection_id: conn.id, provider: "qdrant", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncWeaviate(supabase: any, conn: BillingConnection, apiKey: string, clusterUrl: string): Promise<SyncResult> {
  const monthlyCost  = (conn.config["monthly_cost_usd"] as number | undefined) ?? 0;
  const classFilter  = conn.config["classes"] as string[] | undefined;
  const environment  = conn.config["environment"] as string | undefined;

  const classRows = await getWeaviateClassRows(apiKey, clusterUrl, monthlyCost, classFilter);
  const totalCost = classRows.reduce((s, r) => s + r.costUsd, 0);

  if (totalCost === 0) return { connection_id: conn.id, provider: "weaviate", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  let written = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of classRows) {
    if (row.costUsd === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert(
      {
        org_id:         conn.org_id,
        event_id:       `weaviate-${row.className}-${today}`,
        session_id:     "",
        estimated_cost: 0,
        actual_cost:    row.costUsd,
        cost_source:    "weaviate_nodes_api",
        resource_name:  `weaviate:${row.className}`,
        operation_type: "storage",
        environment:    environment ?? null,
      },
      { onConflict: "org_id,event_id" },
    );
    written++;
  }

  return { connection_id: conn.id, provider: "weaviate", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncAzure(supabase: any, conn: BillingConnection, creds: Record<string, string>, fromDate: string, toDate: string): Promise<SyncResult> {
  const { getAzureCostRows } = await import("./azure");
  const rows      = await getAzureCostRows(creds, fromDate, toDate);
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  const environment = conn.config["environment"] as string | undefined;

  if (totalCost === 0) return { connection_id: conn.id, provider: "azure", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  let written = 0;
  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert(
      {
        org_id:         conn.org_id,
        event_id:       `azure-${row.resourceName.replace(/[^a-z0-9]/gi, "_")}-${fromDate}`,
        session_id:     row.sessionId || "",
        estimated_cost: 0,
        actual_cost:    row.costUsd,
        cost_source:    "azure_cost_management",
        resource_name:  `azure:${row.resourceName}`,
        operation_type: row.operationType || "compute",
        environment:    environment ?? null,
      },
      { onConflict: "org_id,event_id" },
    );
    written++;
  }

  return { connection_id: conn.id, provider: "azure", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncGcp(supabase: any, conn: BillingConnection, creds: Record<string, string>, fromDate: string, toDate: string): Promise<SyncResult> {
  const rows      = await getGcpCostRows(creds, fromDate, toDate);
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
  const env       = conn.config["environment"] as string | undefined;

  if (totalCost === 0) return { connection_id: conn.id, provider: "gcp", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  let written = 0;
  for (const row of rows) {
    if (row.costUsd === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert(
      {
        org_id:         conn.org_id,
        event_id:       `gcp-${row.resourceName.replace(/[^a-z0-9]/gi, "_")}-${fromDate}`,
        session_id:     row.sessionId || "",
        estimated_cost: 0,
        actual_cost:    row.costUsd,
        cost_source:    "gcp_cloud_billing",
        resource_name:  `gcp:${row.resourceName}`,
        operation_type: "compute",
        environment:    env ?? null,
      },
      { onConflict: "org_id,event_id" },
    );
    written++;
  }

  return { connection_id: conn.id, provider: "gcp", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncMilvus(supabase: any, conn: BillingConnection, apiKey: string, clusterUrl: string): Promise<SyncResult> {
  const monthlyCost = (conn.config["monthly_cost_usd"] as number | undefined) ?? 0;
  const colFilter   = conn.config["collections"] as string[] | undefined;
  const environment = conn.config["environment"] as string | undefined;

  const rows      = await getMilvusCollectionRows(apiKey, clusterUrl, monthlyCost, colFilter);
  const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);

  if (totalCost === 0) return { connection_id: conn.id, provider: "milvus", org_id: conn.org_id, total_cost_usd: 0, records_written: 0 };

  let written = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const row of rows) {
    if (row.costUsd === 0) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert(
      {
        org_id:         conn.org_id,
        event_id:       `milvus-${row.collectionName.replace(/[^a-z0-9]/gi, "_")}-${today}`,
        session_id:     "",
        estimated_cost: 0,
        actual_cost:    row.costUsd,
        cost_source:    "milvus_cluster_api",
        resource_name:  `milvus:${row.collectionName}`,
        operation_type: "storage",
        environment:    environment ?? null,
      },
      { onConflict: "org_id,event_id" },
    );
    written++;
  }

  return { connection_id: conn.id, provider: "milvus", org_id: conn.org_id, total_cost_usd: totalCost, records_written: written };
}

/**
 * Distribute a total actual cost proportionally across sessions
 * based on their estimated MCP tool call costs in the same window.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function distributeProportionally(supabase: any, conn: BillingConnection, actualCostUsd: number, costSource: string, fromDate: string, toDate: string): Promise<SyncResult> {
  // Get sessions + estimated costs from the reconciliation table (from mcp_tool_events via Tinybird)
  // We query the existing mcp_cost_reconciliation for sessions in this org/window as a proxy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from("mcp_cost_reconciliation")
    .select("session_id, estimated_cost")
    .eq("org_id", conn.org_id)
    .gte("reconciled_at", `${fromDate}T00:00:00Z`)
    .lte("reconciled_at", `${toDate}T23:59:59Z`)
    .limit(1000) as { data: { session_id: string; estimated_cost: number }[] | null };

  if (!existing?.length) {
    // No sessions to distribute to — store as an org-level summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert({
      org_id:         conn.org_id,
      event_id:       `${conn.provider}-org-${conn.org_id}-${fromDate}`,
      session_id:     "",
      estimated_cost: 0,
      actual_cost:    actualCostUsd,
      cost_source:    costSource,
    }, { onConflict: "org_id,event_id" });
    return { connection_id: conn.id, provider: conn.provider, org_id: conn.org_id, total_cost_usd: actualCostUsd, records_written: 1 };
  }

  const totalEstimated = existing.reduce((s, r) => s + (r.estimated_cost ?? 0), 0);
  if (totalEstimated === 0) return { connection_id: conn.id, provider: conn.provider, org_id: conn.org_id, total_cost_usd: actualCostUsd, records_written: 0 };

  const bySession = new Map<string, number>();
  for (const row of existing) {
    const share = (row.estimated_cost / totalEstimated) * actualCostUsd;
    bySession.set(row.session_id, (bySession.get(row.session_id) ?? 0) + share);
  }

  let written = 0;
  for (const [sessionId, share] of Array.from(bySession.entries())) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from("mcp_cost_reconciliation").upsert({
      org_id:         conn.org_id,
      event_id:       `${conn.provider}-${sessionId}-${fromDate}`,
      session_id:     sessionId,
      estimated_cost: 0,
      actual_cost:    share,
      cost_source:    costSource,
    }, { onConflict: "org_id,event_id" });
    written++;
  }

  return { connection_id: conn.id, provider: conn.provider, org_id: conn.org_id, total_cost_usd: actualCostUsd, records_written: written };
}
