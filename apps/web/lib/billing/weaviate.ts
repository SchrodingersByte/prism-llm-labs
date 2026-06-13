/**
 * Weaviate Cloud billing client for Prism billing sync.
 *
 * Uses the Weaviate REST API to enumerate class sizes, then distributes
 * the connection's monthly_cost_usd proportionally by object count —
 * the same approach used for Qdrant.
 *
 * API reference: https://weaviate.io/developers/weaviate/api/rest/nodes
 */

export interface WeaviateClassRow {
  className:   string;
  objectCount: number;
  costUsd:     number;   // proportional share of total cluster cost
}

interface WeaviateNodeShard {
  class?:       string;
  name?:        string;
  objectCount?: number;
}

interface WeaviateNode {
  name?:   string;
  status?: string;
  shards?: WeaviateNodeShard[];
  stats?:  { objectCount?: number };
}

/**
 * Fetch Weaviate cluster usage and return per-class cost breakdown.
 *
 * Uses GET /v1/nodes to get aggregate shard statistics across all nodes.
 * Distributes monthlyCostUsd proportionally by objectCount per class.
 */
export async function getWeaviateClassRows(
  apiKey:        string,
  clusterUrl:    string,
  monthlyCostUsd: number,
  classFilter?:  string[],
): Promise<WeaviateClassRow[]> {
  const base = clusterUrl.replace(/\/$/, "");

  try {
    const res = await fetch(`${base}/v1/nodes?output=verbose`, {
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      console.warn(`[billing/weaviate] /v1/nodes returned ${res.status} — falling back to cluster-level row`);
      return [{
        className:   "(cluster)",
        objectCount: 0,
        costUsd:     monthlyCostUsd,
      }];
    }

    const json = await res.json() as { nodes?: WeaviateNode[] };
    const nodes = json?.nodes ?? [];

    // Aggregate objectCount per class across all nodes/shards
    const classCounts = new Map<string, number>();
    for (const node of nodes) {
      for (const shard of node.shards ?? []) {
        const cls   = shard.class ?? "(unknown)";
        const count = shard.objectCount ?? 0;
        classCounts.set(cls, (classCounts.get(cls) ?? 0) + count);
      }
    }

    // If we couldn't get shard-level data, fall back to cluster-level total
    if (classCounts.size === 0) {
      const totalObjects = nodes.reduce((s, n) => s + (n.stats?.objectCount ?? 0), 0);
      return [{
        className:   "(cluster)",
        objectCount: totalObjects,
        costUsd:     monthlyCostUsd,
      }];
    }

    // Apply optional class filter
    const entries = classFilter?.length
      ? Array.from(classCounts.entries()).filter(([cls]) => classFilter.includes(cls))
      : Array.from(classCounts.entries());

    const totalObjects = entries.reduce((s, [, count]) => s + count, 0);

    return entries.map(([className, objectCount]) => ({
      className,
      objectCount,
      costUsd: totalObjects > 0
        ? (objectCount / totalObjects) * monthlyCostUsd
        : monthlyCostUsd / entries.length,
    }));
  } catch (err) {
    console.warn(`[billing/weaviate] Failed to fetch class breakdown:`, err);
    return [{
      className:   "(cluster)",
      objectCount: 0,
      costUsd:     monthlyCostUsd,
    }];
  }
}
