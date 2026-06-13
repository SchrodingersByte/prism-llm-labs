/**
 * Qdrant Cloud billing API client for Prism billing sync.
 *
 * Qdrant Cloud exposes cluster usage via their management API.
 * Cost is distributed proportionally by vectors_count, then split
 * per operation type (read / write / storage) matching Pinecone's 3-row pattern
 * so the dashboard `infra_cost_breakdown` shows operation-level granularity.
 */

// Proportional split per operation type (must sum to 1.0)
const QDRANT_READ_SHARE    = 0.40; // search/query requests
const QDRANT_WRITE_SHARE   = 0.20; // upsert/index requests
const QDRANT_STORAGE_SHARE = 0.40; // vector storage on disk

// Estimated cost per request: conservative proxy for Qdrant Cloud
const QDRANT_COST_PER_REQUEST = 0.000001;

export interface QdrantUsage {
  clusterUrl:   string;
  costUsd:      number;
  requestCount: number;
}

export interface QdrantCollectionRow {
  collectionName: string;
  vectorsCount:   number;
  pointsCount:    number;
  /** Per-operation cost for this row's `operationType` */
  costUsd:        number;
  /** Whether this row represents read, write, or storage operations */
  operationType:  "read" | "write" | "storage";
  /** Full cost breakdown for convenience (same value across all 3 rows per collection) */
  readCostUsd:    number;
  writeCostUsd:   number;
  storageCostUsd: number;
}

/**
 * Fetch Qdrant cluster usage and return per-collection cost breakdown.
 *
 * Returns 3 rows per collection — one each for "read", "write", and "storage"
 * (mirroring the Pinecone detail row pattern). The `infra_cost_breakdown`
 * Tinybird pipe groups by `operation_type` for cross-provider comparison.
 */
export async function getQdrantCollectionRows(
  apiKey:            string,
  clusterUrl:        string,
  collectionFilter?: string[],  // if set, only return these collections
): Promise<QdrantCollectionRow[]> {
  const base = clusterUrl.replace(/\/$/, "");
  const rows: QdrantCollectionRow[] = [];

  try {
    // Step 1: get total request count from telemetry
    let totalRequests = 0;
    try {
      const telRes = await fetch(`${base}/telemetry`, {
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
      });
      if (telRes.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tel = await telRes.json() as { result?: { requests_total?: number } };
        totalRequests = tel?.result?.requests_total ?? 0;
      }
    } catch { /* telemetry not available */ }

    // Step 2: get collection sizes
    const colRes = await fetch(`${base}/collections`, {
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
    });
    if (!colRes.ok) {
      // Fallback: return cluster-level rows split by operation type
      const clusterCost = totalRequests * QDRANT_COST_PER_REQUEST;
      const readCost    = clusterCost * QDRANT_READ_SHARE;
      const writeCost   = clusterCost * QDRANT_WRITE_SHARE;
      const storageCost = clusterCost * QDRANT_STORAGE_SHARE;
      return [
        { collectionName: "(cluster)", vectorsCount: 0, pointsCount: 0, operationType: "read",    costUsd: readCost,    readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
        { collectionName: "(cluster)", vectorsCount: 0, pointsCount: 0, operationType: "write",   costUsd: writeCost,   readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
        { collectionName: "(cluster)", vectorsCount: 0, pointsCount: 0, operationType: "storage", costUsd: storageCost, readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const colJson = await colRes.json() as { result?: { collections?: any[] } };
    const collections = colJson?.result?.collections ?? [];

    // Apply optional collection filter
    const filtered = collectionFilter?.length
      ? collections.filter((c: { name?: string }) => collectionFilter.includes(c?.name ?? ""))
      : collections;

    // Total vectors across all (filtered) collections for proportional distribution
    const totalVectors = filtered.reduce(
      (s: number, c: { vectors_count?: number }) => s + (c?.vectors_count ?? 0), 0,
    );
    const totalCost = totalRequests * QDRANT_COST_PER_REQUEST;

    for (const col of filtered) {
      const vectorsCount  = col?.vectors_count ?? 0;
      const share         = totalVectors > 0 ? vectorsCount / totalVectors : 1 / filtered.length;
      const collectionCost = totalCost * share;

      const readCost    = collectionCost * QDRANT_READ_SHARE;
      const writeCost   = collectionCost * QDRANT_WRITE_SHARE;
      const storageCost = collectionCost * QDRANT_STORAGE_SHARE;

      const name       = col?.name ?? "unknown";
      const pointsCount = col?.points_count ?? 0;

      // Three rows per collection — one per operation type
      rows.push(
        { collectionName: name, vectorsCount, pointsCount, operationType: "read",    costUsd: readCost,    readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
        { collectionName: name, vectorsCount, pointsCount, operationType: "write",   costUsd: writeCost,   readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
        { collectionName: name, vectorsCount, pointsCount, operationType: "storage", costUsd: storageCost, readCostUsd: readCost, writeCostUsd: writeCost, storageCostUsd: storageCost },
      );
    }

    return rows;
  } catch (err) {
    console.warn(`[billing/qdrant] Failed to fetch collection breakdown:`, err);
    return [];
  }
}

/**
 * Fetch Qdrant cluster usage summary (backward-compatible).
 */
export async function getQdrantUsage(
  apiKey:     string,
  clusterUrl: string,
  fromDate:   string,
  toDate:     string,
): Promise<QdrantUsage> {
  void fromDate; void toDate; // date filtering not yet available in telemetry API

  const base = clusterUrl.replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/telemetry`, {
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      console.warn(`[billing/qdrant] Telemetry API returned ${res.status}`);
      return { clusterUrl, costUsd: 0, requestCount: 0 };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = await res.json() as { result?: { requests_total?: number } };
    const requestCount = json?.result?.requests_total ?? 0;
    return { clusterUrl, costUsd: requestCount * QDRANT_COST_PER_REQUEST, requestCount };
  } catch (err) {
    console.warn(`[billing/qdrant] Failed to fetch usage:`, err);
    return { clusterUrl, costUsd: 0, requestCount: 0 };
  }
}
