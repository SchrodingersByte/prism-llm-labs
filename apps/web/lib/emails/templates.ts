const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function shell(content: string): string {
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;padding:20px;margin:0;">
  <div style="max-width:520px;margin:0 auto;">
    <div style="background:#6366f1;padding:20px 24px;border-radius:10px 10px 0 0;">
      <span style="color:white;font-weight:700;font-size:16px;">Prism</span>
    </div>
    <div style="background:white;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 10px 10px;">
      ${content}
    </div>
  </div>
</body>
</html>`;
}

function ctaButton(href: string, label: string, color = "#6366f1"): string {
  return `<a href="${esc(href)}" style="display:inline-block;background:${color};color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500;">${esc(label)} &#x2192;</a>`;
}

function kpiBox(label: string, value: string): string {
  return `<div style="flex:1;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;text-align:center;min-width:110px;">
    <div style="color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${esc(label)}</div>
    <div style="color:#1e293b;font-size:20px;font-weight:700;">${esc(value)}</div>
  </div>`;
}

export function buildChargebackReportEmailHtml(params: {
  orgName:      string;
  period:       string;
  totalCostUsd: number;
  providerCount: number;
  momDeltaPct:   number | null;
  downloadUrl:  string;
}): string {
  const { orgName, period, totalCostUsd, providerCount, momDeltaPct, downloadUrl } = params;
  const fmtCost = (n: number) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(2)}`;
  const fmtPct  = (n: number | null) => n === null ? "N/A" : `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
  const pctColor = momDeltaPct !== null && momDeltaPct > 10 ? "#ef4444" : momDeltaPct !== null && momDeltaPct < 0 ? "#10b981" : "#64748b";

  return shell(`
    <h2 style="color:#1e293b;margin:0 0 4px;font-size:20px;">AI Chargeback Report</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;">${esc(orgName)} &mdash; ${esc(period)}</p>

    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px;">
      ${kpiBox("Total AI Spend", fmtCost(totalCostUsd))}
      ${kpiBox("Providers", String(providerCount))}
      ${kpiBox("vs Prior Period", `<span style="color:${pctColor}">${fmtPct(momDeltaPct)}</span>`)}
    </div>

    <p style="color:#475569;font-size:14px;margin:0 0 16px;">
      Your AI chargeback report for <strong>${esc(period)}</strong> is ready.
      Download the full PDF report to share with your finance team or department heads.
    </p>

    <div style="margin-bottom:20px;">
      ${ctaButton(downloadUrl, "Download PDF Report", "#6366f1")}
    </div>

    <p style="color:#94a3b8;font-size:12px;margin-top:20px;">
      View the live FinOps dashboard at
      <a href="${APP_URL}/dashboard/finops" style="color:#6366f1;text-decoration:none;">${APP_URL}/dashboard/finops</a>
    </p>
    <p style="color:#cbd5e1;font-size:11px;margin:4px 0 0;">
      To change report delivery frequency, visit
      <a href="${APP_URL}/dashboard/settings?tab=reports" style="color:#94a3b8;">Settings &rarr; Scheduled Reports</a>.
    </p>
  `);
}

export function buildInviteEmailHtml(params: {
  inviterName: string;
  orgName:     string;
  inviteUrl:   string;
}): string {
  const { inviterName, orgName, inviteUrl } = params;
  return shell(`
    <h2 style="color:#1e293b;margin:0 0 8px;font-size:20px;">You've been invited to ${esc(orgName)}</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;">
      <strong>${esc(inviterName)}</strong> has invited you to join the <strong>${esc(orgName)}</strong>
      workspace on Prism — the LLM cost observability platform.
    </p>
    <div style="background:#f1f5f9;border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#475569;">This invite link expires in <strong>7 days</strong>.</p>
    </div>
    ${ctaButton(inviteUrl, "Accept invitation")}
    <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">
      If you weren't expecting this invitation, you can safely ignore this email.
    </p>
  `);
}

export function buildPaymentFailureEmailHtml(params: {
  orgName:       string;
  nextRetryDate: string;
  updateUrl:     string;
}): string {
  const { orgName, nextRetryDate, updateUrl } = params;
  return shell(`
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
      <p style="margin:0;font-size:14px;color:#dc2626;font-weight:600;">Payment failed</p>
    </div>
    <h2 style="color:#1e293b;margin:0 0 8px;font-size:18px;">Action required for ${esc(orgName)}</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 16px;">
      We were unable to charge your payment method for your Prism subscription.
      Please update your payment details to avoid service interruption.
    </p>
    <p style="color:#64748b;font-size:14px;margin:0 0 24px;">
      <strong>Next retry:</strong> ${esc(nextRetryDate)}. If payment fails after 3 attempts,
      your subscription will be cancelled automatically.
    </p>
    ${ctaButton(updateUrl, "Update payment method", "#ef4444")}
    <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">
      You're receiving this because you're a billing admin for <strong>${esc(orgName)}</strong> on Prism.
    </p>
  `);
}

export function buildWelcomeEmailHtml(params: {
  orgName:      string;
  dashboardUrl: string;
}): string {
  const { orgName, dashboardUrl } = params;
  const docsUrl = `${APP_URL}/docs`;
  return shell(`
    <h2 style="color:#1e293b;margin:0 0 8px;font-size:20px;">Welcome to Prism, ${esc(orgName)}!</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 20px;">
      Your workspace is ready. Start tracking LLM costs in three steps:
    </p>
    <ol style="color:#475569;font-size:14px;padding-left:20px;margin:0 0 24px;">
      <li style="margin-bottom:8px;">Install the SDK: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">pip install prism-llm-labs</code></li>
      <li style="margin-bottom:8px;">Grab your API key from the dashboard</li>
      <li style="margin-bottom:8px;">Replace <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">openai.OpenAI()</code> with <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">prism.OpenAI()</code></li>
    </ol>
    <div style="display:flex;gap:12px;">
      ${ctaButton(dashboardUrl, "Go to dashboard")}
    </div>
    <p style="margin-top:20px;">
      <a href="${esc(docsUrl)}" style="color:#6366f1;font-size:13px;text-decoration:none;">Read the docs &#x2192;</a>
    </p>
  `);
}
