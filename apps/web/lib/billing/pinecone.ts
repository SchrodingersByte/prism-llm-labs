/**
 * Pinecone Usage API client for Prism billing sync.
 *
 * Pinecone does not provide per-session billing data.
 * Costs are attributed proportionally across sessions based on their
 * estimated Pinecone tool call costs within the same time window.
 *
 * API docs: https://docs.pinecone.io/reference/api/2024-07/usage/get_usage_metrics
 */

export interface PineconeUsageRow {
  indexName:   string;
  readUnits:   number;
  writeUnits:  number;
  storageGb:   number;
  costUsd:     number;
}

/**
 * Per-operation cost breakdown for a single Pinecone index.
 * Used to store separate read/write/storage rows in mcp_cost_reconciliation.
 */
export interface PineconeDetailRow {
  indexName:       string;
  readUnits:       number;
  writeUnits:      number;
  storageGb:       number;
  readCostUsd:     number;
  writeCostUsd:    number;
  storageCostUsd:  number;
  totalCostUsd:    number;
}

// Pinecone pricing (serverless, us-east-1, as of 2026)
const READ_UNIT_PRICE  = 0.000001;   // $1 per million read units
const WRITE_UNIT_PRICE = 0.000002;   // $2 per million write units
const STORAGE_PRICE_GB = 0.0945;     // $0.0945 per GB per month (prorated)

/**
 * Fetch Pinecone index usage for a date range.
 * Returns actual billable usage per index (aggregated, backward-compatible).
 */
export async function getPineconeUsage(
  apiKey:   string,
  fromDate: string,  // ISO date YYYY-MM-DD
  toDate:   string,
  indexFilter?: string[],  // optional: only return these index names
): Promise<PineconeUsageRow[]> {
  const detail = await getPineconeDetailRows(apiKey, fromDate, toDate, indexFilter);
  return detail.map(d => ({
    indexName:  d.indexName,
    readUnits:  d.readUnits,
    writeUnits: d.writeUnits,
    storageGb:  d.storageGb,
    costUsd:    d.totalCostUsd,
  }));
}

/**
 * Fetch Pinecone index usage and return per-operation cost breakdown.
 * Used by the billing sync to store separate read/write/storage rows.
 */
export async function getPineconeDetailRows(
  apiKey:   string,
  fromDate: string,
  toDate:   string,
  indexFilter?: string[],  // if set, only return rows for these index names
): Promise<PineconeDetailRow[]> {
  const url = new URL("https://api.pinecone.io/usage/metrics");
  url.searchParams.set("start_time", `${fromDate}T00:00:00Z`);
  url.searchParams.set("end_time",   `${toDate}T23:59:59Z`);

  const res = await fetch(url.toString(), {
    headers: {
      "Api-Key":      apiKey,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pinecone Usage API failed (${res.status}): ${text}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = await res.json() as { indexes?: any[] };
  const rows: PineconeDetailRow[] = [];
  const days = Math.max(1, daysBetween(fromDate, toDate));

  for (const index of json?.indexes ?? []) {
    const indexName = (index?.name ?? "unknown") as string;

    // Apply optional index filter from billing connection config
    if (indexFilter?.length && !indexFilter.includes(indexName)) continue;

    const readUnits  = Number(index?.read_units  ?? 0);
    const writeUnits = Number(index?.write_units ?? 0);
    const storageGb  = Number(index?.storage_gb  ?? 0);

    const readCostUsd    = readUnits  * READ_UNIT_PRICE;
    const writeCostUsd   = writeUnits * WRITE_UNIT_PRICE;
    const storageCostUsd = storageGb  * STORAGE_PRICE_GB * (days / 30);

    rows.push({
      indexName,
      readUnits,
      writeUnits,
      storageGb,
      readCostUsd,
      writeCostUsd,
      storageCostUsd,
      totalCostUsd: readCostUsd + writeCostUsd + storageCostUsd,
    });
  }

  return rows;
}

function daysBetween(from: string, to: string): number {
  return Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000);
}
