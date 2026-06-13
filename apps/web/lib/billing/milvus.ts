/**
 * Milvus / Zilliz Cloud billing client for Prism billing sync.
 *
 * Uses the Zilliz Cloud REST API to enumerate collections by entity count,
 * then distributes monthly_cost_usd proportionally — the same approach as Qdrant.
 *
 * API reference: https://docs.zilliz.com/reference/restful/list-collections
 */

export interface MilvusCollectionRow {
  collectionName: string;
  entityCount:    number;
  costUsd:        number;
}

interface ZillizCollection {
  collectionName?: string;
  rowCount?:       number;
  entityCount?:    number;
}

/**
 * Fetch Milvus/Zilliz collection sizes and return per-collection cost breakdown.
 * Distributes monthlyCostUsd proportionally by entity count.
 */
export async function getMilvusCollectionRows(
  apiKey:          string,
  clusterEndpoint: string,
  monthlyCostUsd:  number,
  collectionFilter?: string[],
): Promise<MilvusCollectionRow[]> {
  const base = clusterEndpoint.replace(/\/$/, "");

  try {
    // Zilliz Cloud REST API — list databases, then collections per database
    const dbRes = await fetch(`${base}/v2/vectordb/databases/list`, {
      headers: {
        Authorization:  `Bearer ${apiKey}`,
        Accept:         "application/json",
        "Content-Type": "application/json",
      },
    });

    let databases: string[] = ["default"];

    if (dbRes.ok) {
      const dbJson = await dbRes.json() as { data?: string[] };
      databases = dbJson.data ?? ["default"];
    }

    const allCollections: MilvusCollectionRow[] = [];

    for (const db of databases) {
      const colRes = await fetch(`${base}/v2/vectordb/collections/list`, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${apiKey}`,
          Accept:         "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ dbName: db }),
      });

      if (!colRes.ok) continue;

      const colJson = await colRes.json() as { data?: string[] };
      const names   = colJson.data ?? [];

      // Apply optional collection filter
      const filtered = collectionFilter?.length
        ? names.filter(n => collectionFilter.includes(n))
        : names;

      // Fetch stats for each collection
      for (const colName of filtered) {
        const statsRes = await fetch(`${base}/v2/vectordb/collections/get_stats`, {
          method:  "POST",
          headers: {
            Authorization:  `Bearer ${apiKey}`,
            Accept:         "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ dbName: db, collectionName: colName }),
        });

        let entityCount = 0;
        if (statsRes.ok) {
          const stats = await statsRes.json() as { data?: { rowCount?: number } };
          entityCount = stats.data?.rowCount ?? 0;
        }

        allCollections.push({
          collectionName: db === "default" ? colName : `${db}/${colName}`,
          entityCount,
          costUsd: 0, // will be set proportionally below
        });
      }
    }

    if (!allCollections.length) {
      return [{ collectionName: "(cluster)", entityCount: 0, costUsd: monthlyCostUsd }];
    }

    const totalEntities = allCollections.reduce((s, c) => s + c.entityCount, 0);

    return allCollections.map(c => ({
      ...c,
      costUsd: totalEntities > 0
        ? (c.entityCount / totalEntities) * monthlyCostUsd
        : monthlyCostUsd / allCollections.length,
    }));
  } catch (err) {
    console.warn("[billing/milvus] Failed to fetch collection breakdown:", err);
    return [{ collectionName: "(cluster)", entityCount: 0, costUsd: monthlyCostUsd }];
  }
}
