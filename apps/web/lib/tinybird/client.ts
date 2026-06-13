const BASE  = process.env.TINYBIRD_API_URL!;
const TOKEN = process.env.TINYBIRD_ADMIN_TOKEN!;

/**
 * Run an ad-hoc SQL query against Tinybird datasources.
 * Works in both Classic and Forward workspaces (unlike named pipes via tb push).
 *
 * SECURITY: only call this with values from trusted sources (auth context, zod-validated params).
 * The caller is responsible for ensuring no user-controlled strings are interpolated directly.
 */
export async function querySql(sql: string): Promise<unknown[]> {
  const url = `${BASE}/v0/sql?q=${encodeURIComponent(sql.trim())}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tinybird SQL error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: unknown[] };
  return json.data;
}

export async function queryTinybird(
  pipe: string,
  params: Record<string, string>,
): Promise<unknown[]> {
  if (!params.org_id) {
    throw new Error("org_id is required — refusing to query without it");
  }

  const qs  = new URLSearchParams(params).toString();
  const url = `${BASE}/v0/pipes/${pipe}.json?${qs}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    next: { revalidate: 30 },
  });

  if (!res.ok) {
    const text = await res.text();
    // 429 = free-tier daily limit; degrade gracefully so pages still render
    if (res.status === 429) {
      console.warn(`[tinybird] rate-limited on pipe "${pipe}" — returning empty data`);
      return [];
    }
    throw new Error(`Tinybird ${pipe} error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as { data: unknown[] };
  return json.data;
}

export async function ingestToTinybird(
  events: object[],
  datasource = "llm_events",
): Promise<void> {
  // The llm_events datasource has non-nullable `session_id` and `attributes`
  // columns (added in the trace/session schema evolution). Tinybird strict-mode
  // quarantines any row missing them, so guarantee both are present here — once,
  // at the ingest chokepoint — rather than in every event-builder. session_id is
  // pulled from tags so session linkage is preserved.
  const normalised = datasource === "llm_events"
    ? events.map((e) => {
        const ev   = e as Record<string, unknown>;
        const tags = ev.tags as Record<string, string> | undefined;
        return {
          ...ev,
          session_id: (ev.session_id as string) || tags?.session_id || "",
          attributes: (ev.attributes as string) || "",
          // New non-nullable column (modality analytics). Default it at the chokepoint
          // so any event-builder/source that predates it isn't strict-mode quarantined.
          reasoning_tokens: (ev.reasoning_tokens as number) ?? 0,
        };
      })
    : events;

  const ndjson = normalised.map((e) => JSON.stringify(e)).join("\n");

  for (let attempt = 0; attempt < 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${BASE}/v0/events?name=${encodeURIComponent(datasource)}`, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${TOKEN}`,
          "Content-Type": "application/x-ndjson",
        },
        body: ndjson,
      });
    } catch (networkErr) {
      if (attempt === 2) throw networkErr;
      await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
      continue;
    }

    if (res.ok) return;

    // 4xx = bad data; retrying won't help
    if (res.status < 500) {
      const text = await res.text();
      throw new Error(`Tinybird ingest error ${res.status}: ${text}`);
    }

    // 5xx = upstream issue; retry with backoff
    if (attempt === 2) {
      const text = await res.text();
      throw new Error(`Tinybird ingest error ${res.status}: ${text}`);
    }
    await new Promise((r) => setTimeout(r, 200 * 2 ** attempt));
  }
}
