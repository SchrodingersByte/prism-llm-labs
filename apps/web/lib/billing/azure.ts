/**
 * Azure Cost Management billing client for Prism billing sync.
 *
 * Uses the Azure Cost Management REST API with service principal auth
 * to fetch costs for Azure OpenAI / Azure AI Services, optionally
 * filtered by the `prism-session-id` resource tag.
 *
 * API reference: https://learn.microsoft.com/en-us/rest/api/cost-management/
 */

export interface AzureCostRow {
  resourceName:  string;
  costUsd:       number;
  sessionId:     string;   // from prism-session-id tag, if present
  operationType: string;
  serviceFamily: string;
}

interface AzureCredentials {
  subscription_id: string;
  tenant_id:       string;
  client_id:       string;
  client_secret:   string;
}

const AZURE_RESOURCE_SERVICES = [
  "Cognitive Services",
  "Azure OpenAI",
  "Azure AI Services",
  "Machine Learning",
];

/**
 * Fetch an Azure service principal OAuth2 access token.
 */
async function getAzureToken(creds: AzureCredentials): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${creds.tenant_id}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type:    "client_credentials",
        client_id:     creds.client_id,
        client_secret: creds.client_secret,
        scope:         "https://management.azure.com/.default",
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Azure auth failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = await res.json() as { access_token?: string };
  if (!json.access_token) throw new Error("Azure auth response missing access_token");
  return json.access_token;
}

/**
 * Query Azure Cost Management for AI/Cognitive Services spend in a date range.
 * Returns per-resource cost rows with optional session attribution.
 */
export async function getAzureCostRows(
  creds:    Record<string, string>,
  fromDate: string,
  toDate:   string,
): Promise<AzureCostRow[]> {
  const azureCreds = creds as unknown as AzureCredentials;
  const { subscription_id } = azureCreds;

  let token: string;
  try {
    token = await getAzureToken(azureCreds);
  } catch (err) {
    console.warn("[billing/azure] Auth failed:", err);
    return [];
  }

  // Cost Management query — group by resource + tag
  const queryBody = {
    type:      "Usage",
    timeframe: "Custom",
    timePeriod: { from: `${fromDate}T00:00:00Z`, to: `${toDate}T23:59:59Z` },
    dataset: {
      granularity: "None",
      aggregation: {
        totalCost: { name: "PreTaxCost", function: "Sum" },
      },
      grouping: [
        { type: "Dimension", name: "ServiceName" },
        { type: "Dimension", name: "ResourceGroup" },
        { type: "TagKey",    name: "prism-session-id" },
      ],
      filter: {
        or: AZURE_RESOURCE_SERVICES.map(service => ({
          dimensions: {
            name:     "ServiceName",
            operator: "In",
            values:   [service],
          },
        })),
      },
    },
  };

  try {
    const url = `https://management.azure.com/subscriptions/${subscription_id}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(queryBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[billing/azure] Cost Management query failed (${res.status}): ${text.slice(0, 200)}`);
      return [];
    }

    const json = await res.json() as {
      properties?: {
        columns?: Array<{ name: string; type: string }>;
        rows?:    unknown[][];
      };
    };

    const columns = json.properties?.columns ?? [];
    const rows    = json.properties?.rows    ?? [];

    const costIdx      = columns.findIndex(c => c.name === "PreTaxCost");
    const serviceIdx   = columns.findIndex(c => c.name === "ServiceName");
    const rgIdx        = columns.findIndex(c => c.name === "ResourceGroup");
    const sessionIdx   = columns.findIndex(c => c.name === "prism-session-id");

    const result: AzureCostRow[] = [];

    for (const row of rows) {
      const costUsd   = typeof row[costIdx] === "number" ? row[costIdx] as number : parseFloat(String(row[costIdx] ?? "0"));
      if (costUsd === 0) continue;

      const service   = String(row[serviceIdx] ?? "Azure AI");
      const rg        = String(row[rgIdx]      ?? "");
      const sessionId = sessionIdx >= 0 ? String(row[sessionIdx] ?? "") : "";

      result.push({
        resourceName:  rg ? `${service}/${rg}` : service,
        costUsd,
        sessionId,
        operationType: "compute",
        serviceFamily: service,
      });
    }

    return result;
  } catch (err) {
    console.warn("[billing/azure] Cost query failed:", err);
    return [];
  }
}
