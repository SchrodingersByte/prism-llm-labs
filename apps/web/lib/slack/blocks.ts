/**
 * Block Kit message builders for the Prism Slack App.
 */

function fmtCost(n: number): string {
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPct(n: number | null): string {
  if (n === null) return "N/A";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export interface BudgetStatus {
  spend_usd:             number;
  limit_usd:             number | null;
  utilization_pct:       number | null;
  days_elapsed:          number;
  days_in_month:         number;
  daily_burn_rate:       number;
  rolling_7d_burn_rate?: number;
  projected_month_end:   number;
  projected_overage:     number;
  budget_status?:        "on_track" | "at_risk" | "over_budget";
}

export function buildBudgetBlocks(data: BudgetStatus, orgName: string) {
  const statusEmoji =
    data.budget_status === "over_budget" ? "🔴"
    : data.budget_status === "at_risk"   ? "🟡"
    : "🟢";

  const utilizationBar = data.utilization_pct !== null
    ? `${"█".repeat(Math.min(Math.round(data.utilization_pct / 10), 10))}${"░".repeat(Math.max(0, 10 - Math.round(data.utilization_pct / 10)))} ${data.utilization_pct.toFixed(0)}%`
    : "No budget set";

  return {
    text: `${statusEmoji} Budget status for ${orgName}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `${statusEmoji} Budget Status — ${orgName}` },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*This Month*\n${fmtCost(data.spend_usd)}${data.limit_usd ? ` / ${fmtCost(data.limit_usd)}` : ""}` },
          { type: "mrkdwn", text: `*Utilization*\n${utilizationBar}` },
          { type: "mrkdwn", text: `*Daily Burn (7d avg)*\n${fmtCost(data.rolling_7d_burn_rate ?? data.daily_burn_rate)}/day` },
          { type: "mrkdwn", text: `*Projected Month-End*\n${fmtCost(data.projected_month_end)}${data.projected_overage > 0 ? ` ⚠️ +${fmtCost(data.projected_overage)} over` : ""}` },
          { type: "mrkdwn", text: `*Day*\n${data.days_elapsed} of ${data.days_in_month}` },
        ],
      },
      { type: "divider" },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View FinOps Dashboard" },
            url:  `${process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev"}/dashboard/finops`,
          },
        ],
      },
    ],
  };
}

export interface ProviderSpend { provider: string; total_cost_usd: number; total_requests: number }

export function buildSpendBlocks(vendors: ProviderSpend[], from: string, to: string, orgName: string) {
  const total = vendors.reduce((s, v) => s + v.total_cost_usd, 0);

  const rows = vendors.slice(0, 5).map(v => {
    const pct = total > 0 ? (v.total_cost_usd / total) * 100 : 0;
    return `• *${v.provider}*: ${fmtCost(v.total_cost_usd)} (${pct.toFixed(0)}%) · ${v.total_requests.toLocaleString()} reqs`;
  });

  return {
    text: `LLM spend for ${orgName}: ${fmtCost(total)}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `💸 LLM Spend — ${orgName}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Total:* ${fmtCost(total)}\n_${from.slice(0, 10)} → ${to.slice(0, 10)}_` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: rows.join("\n") || "No data for this period." },
      },
      { type: "divider" },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "View in Dashboard" },
          url: `${process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev"}/dashboard`,
        }],
      },
    ],
  };
}

export function buildApprovalBlocks(
  requestId: string,
  model:     string,
  requester: string,
  reason:    string,
) {
  return {
    text: `Model approval request: ${model}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "🔐 Model Governance: Approval Request" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Model:*\n${model}` },
          { type: "mrkdwn", text: `*Requested by:*\n${requester}` },
          { type: "mrkdwn", text: `*Reason:*\n${reason || "No reason provided"}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type:      "button",
            action_id: `approve_model:${requestId}`,
            style:     "primary",
            text:      { type: "plain_text", text: "✅ Approve" },
            value:     requestId,
            confirm: {
              title:   { type: "plain_text", text: "Approve this model?" },
              text:    { type: "mrkdwn",     text: `Allow use of *${model}* for this org.` },
              confirm: { type: "plain_text", text: "Approve" },
              deny:    { type: "plain_text", text: "Cancel" },
            },
          },
          {
            type:      "button",
            action_id: `deny_model:${requestId}`,
            style:     "danger",
            text:      { type: "plain_text", text: "❌ Deny" },
            value:     requestId,
          },
        ],
      },
    ],
  };
}
