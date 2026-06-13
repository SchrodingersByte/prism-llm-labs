import { Resend } from "resend";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";

// ── Security helpers ──────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

// Block SSRF: reject private / loopback / link-local URLs in webhook fields.
// Accepts only http/https with publicly routable destinations.
function isAllowedWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();

  // Loopback
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return false;

  // Resolve dotted-decimal IPv4 to check private ranges
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [, a, b, c] = ipv4.map(Number);
    if (
      a === 10 ||                          // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) ||           // 192.168.0.0/16
      (a === 169 && b === 254) ||           // 169.254.0.0/16 — AWS metadata etc.
      a === 0 ||
      a === 127                             // 127.0.0.0/8
    ) {
      return false;
    }
  }

  return true;
}

const TRIGGER_LABELS: Record<string, string> = {
  budget_threshold: "Budget threshold",
  spend_spike:      "Spend spike",
  error_rate:       "Error rate",
  single_call_cost: "Single call cost",
  daily_limit:      "Daily spend limit",
  pii_detection:    "PII detected in prompt",
};

function formatMetric(triggerType: string, value: number): string {
  switch (triggerType) {
    case "budget_threshold": return `${value.toFixed(1)}% of budget`;
    case "spend_spike":      return `${value.toFixed(2)}× yesterday's spend`;
    case "error_rate":       return `${(value * 100).toFixed(2)}% error rate`;
    case "single_call_cost": return `$${value.toFixed(4)} per call`;
    case "daily_limit":      return `$${value.toFixed(4)} today`;
    case "pii_detection":    return `${value} PII incident${value !== 1 ? "s" : ""} detected`;
    default:                 return String(value);
  }
}

function formatThreshold(triggerType: string, threshold: number): string {
  switch (triggerType) {
    case "budget_threshold": return `${threshold}%`;
    case "spend_spike":      return `${threshold}× spike`;
    case "error_rate":       return `${threshold}%`;
    case "single_call_cost": return `$${threshold.toFixed(4)}`;
    case "daily_limit":      return `$${threshold.toFixed(4)}`;
    case "pii_detection":    return `${threshold} incident${threshold !== 1 ? "s" : ""} per hour`;
    default:                 return String(threshold);
  }
}

function buildEmailHtml(params: {
  ruleName: string;
  orgName: string;
  triggerType: string;
  metricValue: number;
  threshold: number;
}): string {
  const { ruleName, orgName, triggerType, metricValue, threshold } = params;
  // Escape all user-supplied values before embedding in HTML
  const safeRuleName    = escapeHtml(ruleName);
  const safeOrgName     = escapeHtml(orgName);
  const safeTrigger     = escapeHtml(TRIGGER_LABELS[triggerType] ?? triggerType);
  const safeMetric      = escapeHtml(formatMetric(triggerType, metricValue));
  const safeThreshold   = escapeHtml(formatThreshold(triggerType, threshold));
  const safeDashboardUrl = escapeHtml(`${APP_URL}/dashboard/alerts`);
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:20px;margin:0;">
  <div style="max-width:520px;margin:0 auto;">
    <div style="background:#6366f1;padding:20px 24px;border-radius:10px 10px 0 0;">
      <span style="color:white;font-weight:700;font-size:16px;">Prism Alert</span>
    </div>
    <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;">
      <h2 style="color:#1e293b;margin:0 0 6px;font-size:20px;">${safeRuleName}</h2>
      <p style="color:#64748b;margin:0 0 20px;font-size:14px;">Triggered for <strong>${safeOrgName}</strong></p>
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:20px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr>
            <td style="padding:4px 0;color:#64748b;font-weight:500;">Trigger type</td>
            <td style="padding:4px 0;color:#1e293b;text-align:right;">${safeTrigger}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#64748b;font-weight:500;">Current value</td>
            <td style="padding:4px 0;color:#ef4444;font-weight:700;text-align:right;">${safeMetric}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#64748b;font-weight:500;">Threshold</td>
            <td style="padding:4px 0;color:#1e293b;text-align:right;">${safeThreshold}</td>
          </tr>
        </table>
      </div>
      <a href="${safeDashboardUrl}" style="display:inline-block;background:#6366f1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">View dashboard &#x2192;</a>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">
        You&#x27;re receiving this as an admin of ${safeOrgName} on Prism.
        <a href="${safeDashboardUrl}" style="color:#94a3b8;">Manage alerts</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendAlertEmail(params: {
  to: string[];
  ruleName: string;
  orgName: string;
  triggerType: string;
  metricValue: number;
  threshold: number;
}): Promise<void> {
  if (!process.env.RESEND_API_KEY || params.to.length === 0) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from:    process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
    to:      params.to,
    subject: `⚠️ [Prism] Alert: ${params.ruleName} triggered`,
    html:    buildEmailHtml(params),
  });
}

export async function sendSlackAlert(params: {
  webhookUrl: string;
  ruleName: string;
  orgName: string;
  triggerType: string;
  metricValue: number;
  threshold: number;
}): Promise<void> {
  const { webhookUrl, ruleName, orgName, triggerType, metricValue, threshold } = params;
  if (!isAllowedWebhookUrl(webhookUrl)) {
    throw new Error(`Blocked webhook URL: ${webhookUrl}`);
  }
  await fetch(webhookUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal:  AbortSignal.timeout(5000),
    body: JSON.stringify({
      text: `⚠️ *Prism Alert:* ${ruleName} triggered`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `⚠️ Alert: ${ruleName}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Organization:*\n${orgName}` },
            { type: "mrkdwn", text: `*Trigger:*\n${TRIGGER_LABELS[triggerType] ?? triggerType}` },
            { type: "mrkdwn", text: `*Current Value:*\n${formatMetric(triggerType, metricValue)}` },
            { type: "mrkdwn", text: `*Threshold:*\n${formatThreshold(triggerType, threshold)}` },
          ],
        },
        {
          type: "actions",
          elements: [{
            type: "button",
            text:  { type: "plain_text", text: "View Dashboard" },
            url:   `${APP_URL}/dashboard/alerts`,
            style: "primary",
          }],
        },
      ],
    }),
  });
}

export async function sendCustomWebhook(params: {
  url: string;
  ruleName: string;
  orgName: string;
  triggerType: string;
  metricValue: number;
  threshold: number;
}): Promise<void> {
  if (!isAllowedWebhookUrl(params.url)) {
    throw new Error(`Blocked webhook URL: ${params.url}`);
  }
  await fetch(params.url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal:  AbortSignal.timeout(5000),
    body: JSON.stringify({
      source:        "prism",
      event:         "alert.fired",
      rule_name:     params.ruleName,
      org_name:      params.orgName,
      trigger_type:  params.triggerType,
      metric_value:  params.metricValue,
      threshold:     params.threshold,
      fired_at:      new Date().toISOString(),
      dashboard_url: `${APP_URL}/dashboard/alerts`,
    }),
  });
}
