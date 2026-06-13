/**
 * One-time setup: embed 20 sample support documents and upsert to Pinecone.
 *
 * Embedding calls route through the Prism gateway so they appear in
 * /dashboard/models as text-embedding-3-small usage.
 *
 * Idempotent — re-running overwrites vectors by doc_id.
 *
 * Usage:
 *   source .env.e2e
 *   ts-node --project scripts/e2e/tsconfig.json scripts/e2e/live/load-pinecone.ts
 */

require("dotenv").config({ path: ".env.e2e" });

import { Pinecone } from "@pinecone-database/pinecone";

const OPENAI_API_KEY   = process.env.OPENAI_API_KEY!;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY!;
const PINECONE_INDEX   = process.env.PINECONE_INDEX ?? "prism-test-docs";
const APP_URL          = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const PRISM_API_KEY    = process.env.PRISM_API_KEY!;

if (!PINECONE_API_KEY) {
  console.error("[load-pinecone] PINECONE_API_KEY not set in .env.e2e");
  process.exit(1);
}
if (!PRISM_API_KEY) {
  console.error("[load-pinecone] PRISM_API_KEY not set in .env.e2e");
  process.exit(1);
}

// ── Sample documents ──────────────────────────────────────────────────────────
const DOCUMENTS = [
  { id: "doc-001", title: "How to reset your password",                category: "account",    text: "To reset your password, go to the login page and click 'Forgot Password'. Enter your email address and we will send you a reset link within 5 minutes. Check your spam folder if you don't see it." },
  { id: "doc-002", title: "Billing FAQ: when am I charged?",           category: "billing",    text: "You are charged on the first of each month for your current plan. Charges appear on your credit card within 1-3 business days. You can view your invoice history in Settings > Billing." },
  { id: "doc-003", title: "How to cancel your subscription",           category: "billing",    text: "To cancel your subscription, go to Settings > Billing > Cancel Plan. Your access continues until the end of the current billing period. You will receive a confirmation email within 24 hours." },
  { id: "doc-004", title: "Supported file formats for upload",         category: "product",    text: "We support PDF, DOCX, XLSX, CSV, PNG, JPG, and WEBP files. Maximum file size is 50MB per file. Batch uploads support up to 100 files at once." },
  { id: "doc-005", title: "How to invite team members",                category: "account",    text: "Go to Settings > Team > Invite Members. Enter the email addresses of your colleagues. They will receive an invitation email and can join your workspace within 7 days." },
  { id: "doc-006", title: "API rate limits and quotas",                category: "technical",  text: "Standard plan: 1,000 requests/minute, 100K tokens/day. Pro plan: 10,000 requests/minute, 1M tokens/day. Enterprise: custom limits. Rate limit errors return HTTP 429 with a Retry-After header." },
  { id: "doc-007", title: "Setting up SSO with SAML",                  category: "technical",  text: "Enterprise plans support SAML 2.0 SSO. Go to Settings > Security > SSO. You will need your Identity Provider's SSO URL, certificate, and Entity ID. Contact support for Okta, Azure AD, or Google Workspace setup guides." },
  { id: "doc-008", title: "Data retention and deletion policy",        category: "compliance", text: "User data is retained for 90 days after account deletion. You can request immediate deletion by contacting privacy@company.com. GDPR right-to-erasure requests are processed within 30 days." },
  { id: "doc-009", title: "How to export your data",                   category: "account",    text: "Go to Settings > Data > Export. You can export all your data in JSON or CSV format. Exports for large accounts may take up to 24 hours. You will receive a download link by email when ready." },
  { id: "doc-010", title: "Webhook configuration guide",               category: "technical",  text: "Go to Settings > Integrations > Webhooks. Add your endpoint URL and select the events to subscribe to. We sign all webhooks with HMAC-SHA256 using your webhook secret. Retry policy: 3 attempts with exponential backoff." },
  { id: "doc-011", title: "Two-factor authentication setup",           category: "account",    text: "Enable 2FA in Settings > Security > Two-Factor Authentication. We support TOTP apps (Authy, Google Authenticator) and SMS. Save your backup codes in a secure location — they cannot be recovered if lost." },
  { id: "doc-012", title: "Understanding usage metrics",               category: "product",    text: "Usage metrics update every 15 minutes on the dashboard. API calls, token consumption, and latency are tracked per API key and per project. Historical data is retained for your plan's data window (30-365 days)." },
  { id: "doc-013", title: "How to handle 401 Unauthorized errors",     category: "technical",  text: "A 401 error means your API key is invalid or expired. Check that you are using the correct key for your environment (development vs production). Keys are invalidated after 90 days of inactivity or if manually revoked." },
  { id: "doc-014", title: "Slack integration setup",                   category: "product",    text: "Install our Slack app from the Slack App Directory. Authorize the app to your workspace. Configure alerts in Settings > Integrations > Slack. Alerts fire on budget thresholds, anomaly detection, and system status changes." },
  { id: "doc-015", title: "How billing works for team accounts",       category: "billing",    text: "Team accounts are billed per seat per month. Adding a new member mid-month is prorated to the remaining days. Removing a member takes effect at the end of the billing period. Minimum 1 seat required." },
  { id: "doc-016", title: "Custom domains and white-labeling",         category: "product",    text: "Enterprise plans support custom domains and white-label branding. Configure your domain in Settings > Workspace > Custom Domain. DNS propagation takes 24-48 hours. SSL certificates are provisioned automatically." },
  { id: "doc-017", title: "Model routing and fallback configuration",  category: "technical",  text: "Configure fallback models in Settings > Integrations > Routing Rules. When the primary model returns a 429 or 503, the gateway automatically retries with the fallback model. Routing rules can be scoped per API key." },
  { id: "doc-018", title: "Cost allocation and chargeback",            category: "billing",    text: "Use cost center tags (x-prism-cost-center header) to attribute LLM spend to business units. Generate chargeback reports in FinOps > Cost Centers. Exports available in CSV for accounting software integration." },
  { id: "doc-019", title: "How to report a security vulnerability",    category: "compliance", text: "Report security vulnerabilities to security@company.com. We follow responsible disclosure with a 90-day disclosure timeline. Critical vulnerabilities are acknowledged within 24 hours and patched within 7 days." },
  { id: "doc-020", title: "Getting started with the Python SDK",       category: "technical",  text: "Install with: pip install prism-llm-labs. Set PRISM_API_KEY environment variable. The SDK wraps openai and anthropic clients automatically. See docs.company.com/sdk/python for full reference." },
];

async function embed(texts: string[]): Promise<number[][]> {
  // Route embedding calls through the Prism gateway for tracking
  const res = await fetch(`${APP_URL}/api/gateway/openai/v1/embeddings`, {
    method:  "POST",
    headers: {
      "Authorization":    `Bearer ${PRISM_API_KEY}`,
      "Content-Type":     "application/json",
      "x-prism-feature":  "doc-indexing",
      "x-prism-action":   "embed-documents",
    },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });

  if (!res.ok) {
    const err = await res.text();
    // Fallback to direct OpenAI if gateway not available
    console.warn(`[load-pinecone] Gateway embed failed (${res.status}), falling back to direct OpenAI: ${err.slice(0, 100)}`);
    return embedDirect(texts);
  }

  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

async function embedDirect(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method:  "POST",
    headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  const data = await res.json() as { data: { embedding: number[] }[] };
  return data.data.map((d) => d.embedding);
}

async function run() {
  console.log(`[load-pinecone] Connecting to Pinecone index: ${PINECONE_INDEX}`);

  const pc    = new Pinecone({ apiKey: PINECONE_API_KEY });
  const index = pc.index(PINECONE_INDEX);

  // Batch embed in groups of 10
  const batchSize = 10;
  const vectors: { id: string; values: number[]; metadata: Record<string, string> }[] = [];

  for (let i = 0; i < DOCUMENTS.length; i += batchSize) {
    const batch = DOCUMENTS.slice(i, i + batchSize);
    console.log(`[load-pinecone] Embedding docs ${i + 1}–${Math.min(i + batchSize, DOCUMENTS.length)}...`);

    const embeddings = await embed(batch.map((d) => `${d.title}\n\n${d.text}`));

    for (let j = 0; j < batch.length; j++) {
      const doc = batch[j];
      vectors.push({
        id:       doc.id,
        values:   embeddings[j],
        metadata: { title: doc.title, category: doc.category, text: doc.text.slice(0, 500) },
      });
    }
  }

  console.log(`[load-pinecone] Upserting ${vectors.length} vectors to Pinecone...`);
  await index.upsert(vectors);

  console.log(`[load-pinecone] Done! ${vectors.length} documents indexed in "${PINECONE_INDEX}"`);
  console.log(`[load-pinecone] The search_documents MCP tool will now return real results.`);
}

run().catch((err) => {
  console.error("[load-pinecone] Fatal:", err);
  process.exit(1);
});
