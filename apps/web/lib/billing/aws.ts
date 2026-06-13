/**
 * AWS Cost Explorer client for Prism billing sync.
 *
 * Required IAM permissions:
 *   - ce:GetCostAndUsage
 *
 * For tag-based attribution, your AWS resources must be tagged:
 *   - prism-session-id: <session_id>
 *   - prism-project-id: <project_id>
 *
 * The Cost Explorer API is only available in us-east-1.
 */

export interface AWSCredentials {
  access_key_id:     string;
  secret_access_key: string;
  region?:           string;
}

export interface ServiceCost {
  service:  string;
  amountUsd: number;
}

/**
 * Get costs by service for an AWS account over a date range.
 * Uses the Cost Explorer GetCostAndUsage API.
 */
export async function getCostsByService(
  creds:    AWSCredentials,
  fromDate: string,   // YYYY-MM-DD
  toDate:   string,   // YYYY-MM-DD (exclusive — use tomorrow for "through today")
): Promise<ServiceCost[]> {
  const body = {
    TimePeriod:  { Start: fromDate, End: toDate },
    Granularity: "DAILY",
    GroupBy:     [{ Type: "DIMENSION", Key: "SERVICE" }],
    Metrics:     ["UnblendedCost"],
  };

  const response = await callCostExplorer(creds, "GetCostAndUsage", body);
  const results:  ServiceCost[] = [];

  for (const result of (response?.ResultsByTime ?? []) as Record<string, unknown>[]) {
    for (const group of (result?.["Groups"] ?? []) as Record<string, unknown>[]) {
      const service   = (group?.["Keys"] as string[] | undefined)?.[0] ?? "unknown";
      const amountStr = ((group?.["Metrics"] as Record<string, unknown>)?.["UnblendedCost"] as Record<string, string> | undefined)?.["Amount"] ?? "0";
      results.push({ service, amountUsd: parseFloat(amountStr) });
    }
  }

  // Aggregate by service across all days in the range
  const byService = new Map<string, number>();
  for (const r of results) {
    byService.set(r.service, (byService.get(r.service) ?? 0) + r.amountUsd);
  }
  return Array.from(byService.entries()).map(([service, amountUsd]) => ({ service, amountUsd }));
}

/**
 * Get costs filtered by a resource tag — for exact session/project attribution.
 * Requires resources to be tagged with prism-session-id or prism-project-id.
 */
export async function getCostsByTag(
  creds:     AWSCredentials,
  tagKey:    string,   // e.g. "prism-session-id"
  tagValue:  string,   // e.g. "abc-123"
  fromDate:  string,
  toDate:    string,
): Promise<number> {
  const body = {
    TimePeriod:  { Start: fromDate, End: toDate },
    Granularity: "MONTHLY",
    Filter: {
      Tags: {
        Key:    tagKey,
        Values: [tagValue],
      },
    },
    Metrics: ["UnblendedCost"],
  };

  const response = await callCostExplorer(creds, "GetCostAndUsage", body);
  let total = 0;
  for (const result of (response?.ResultsByTime ?? []) as Record<string, unknown>[]) {
    total += parseFloat(((result?.["Total"] as Record<string, unknown>)?.["UnblendedCost"] as Record<string, string> | undefined)?.["Amount"] ?? "0");
  }
  return total;
}

// ── AWS Signature V4 REST client ──────────────────────────────────────────────

async function callCostExplorer(
  creds:  AWSCredentials,
  action: string,
  body:   unknown,
): Promise<Record<string, unknown>> {
  const region  = "us-east-1"; // Cost Explorer is global, only available here
  const service = "ce";
  const host    = `${service}.${region}.amazonaws.com`;
  const url     = `https://${host}/`;

  const bodyStr = JSON.stringify(body);
  const now     = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dateStr = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    "Content-Type":        "application/x-amz-json-1.1",
    "X-Amz-Date":          amzDate,
    "X-Amz-Target":        `AWSInsightsIndexService.${action}`,
    "Host":                host,
  };

  // Sign the request
  const signature = await signV4({
    method:  "POST",
    url,
    headers,
    body:    bodyStr,
    service,
    region,
    accessKeyId:     creds.access_key_id,
    secretAccessKey: creds.secret_access_key,
    amzDate,
    dateStr,
  });

  headers["Authorization"] = signature;

  const res = await fetch(url, { method: "POST", headers, body: bodyStr });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AWS Cost Explorer ${action} failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// Minimal AWS Signature V4 implementation (HMAC-SHA256)
async function signV4(opts: {
  method: string; url: string; headers: Record<string, string>;
  body: string; service: string; region: string;
  accessKeyId: string; secretAccessKey: string;
  amzDate: string; dateStr: string;
}): Promise<string> {
  const { method, headers, body, service, region, accessKeyId, secretAccessKey, amzDate, dateStr } = opts;

  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
    .sort().join("\n") + "\n";
  const signedHeaders = Object.keys(headers).map(k => k.toLowerCase()).sort().join(";");

  const bodyHash = await sha256Hex(body);
  const canonicalRequest = [method, "/", "", canonicalHeaders, signedHeaders, bodyHash].join("\n");
  const credentialScope   = `${dateStr}/${region}/${service}/aws4_request`;
  const stringToSign      = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256Hex(canonicalRequest)].join("\n");

  const signingKey = await hmacChain(
    `AWS4${secretAccessKey}`, [dateStr, region, service, "aws4_request"],
  );
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const buf  = await crypto.subtle.digest("SHA-256", encoded.buffer as ArrayBuffer);
  return toHex(new Uint8Array(buf));
}

async function hmac(key: Uint8Array | string, data: string): Promise<Uint8Array> {
  const k   = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const ck  = await crypto.subtle.importKey("raw", k.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const encoded = new TextEncoder().encode(data);
  const buf = await crypto.subtle.sign("HMAC", ck, encoded.buffer as ArrayBuffer);
  return new Uint8Array(buf);
}

async function hmacChain(key: string, parts: string[]): Promise<Uint8Array> {
  let current: Uint8Array | string = key;
  for (const p of parts) current = await hmac(current, p);
  return current as Uint8Array;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
}
