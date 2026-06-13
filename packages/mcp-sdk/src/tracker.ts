import type { McpEvent } from "./types";

function defaultIngestUrl(): string {
  const appUrl = (
    process.env["PRISM_APP_URL"] ??
    process.env["NEXT_PUBLIC_APP_URL"] ??
    "https://useprism.dev"
  ).replace(/\/$/, "");
  return `${appUrl}/api/mcp/ingest`;
}

function orgFromKey(key: string): string {
  const parts = key.split("_");
  return parts.length >= 4 ? (parts[2] ?? "") : "";
}

export class McpEventTracker {
  private readonly key:        string;
  private readonly ingestUrl:  string;
  private readonly serverName: string;
  private readonly orgId:      string;

  constructor(key: string, serverName: string, ingestUrl?: string) {
    this.key        = key;
    this.ingestUrl  = ingestUrl ?? defaultIngestUrl();
    this.serverName = serverName;
    this.orgId      = orgFromKey(key);
  }

  async capture(event: Omit<McpEvent, "event_id" | "org_id" | "mcp_server_name">): Promise<void> {
    try {
      const full: McpEvent = {
        ...event,
        event_id:        crypto.randomUUID(),
        org_id:          this.orgId,
        mcp_server_name: this.serverName,
      };

      const res = await fetch(this.ingestUrl, {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${this.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ events: [full] }),
      });

      if (!res.ok && res.status !== 422) {
        // Silently ignore — observability must never break the agent
        console.warn(`[prism-mcp] Ingest returned ${res.status}`);
      }
    } catch {
      // Never propagate
    }
  }
}
