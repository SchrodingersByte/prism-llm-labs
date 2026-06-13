/**
 * Slash command handlers for /prism.
 *
 * Each handler receives the Slack payload and returns a Block Kit message.
 * Handlers that need > 3s to respond should use the response_url for deferred replies.
 */
import {
  buildBudgetBlocks,
  buildSpendBlocks,
  type BudgetStatus,
  type ProviderSpend,
} from "./blocks";

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function todayEnd() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://useprism.dev";

export async function handleBudget(orgId: string, orgName: string): Promise<object> {
  const res = await fetch(`${APP_URL}/api/metrics/budget-status`, {
    headers: {
      Cookie:          `prism_org=${orgId}`,
      "x-prism-org":   orgId,
    },
  }).catch(() => null);

  if (!res?.ok) {
    return { text: "⚠️ Could not fetch budget data. Please check the dashboard." };
  }

  const data = await res.json() as BudgetStatus;
  return buildBudgetBlocks(data, orgName);
}

export async function handleSpend(orgId: string, orgName: string): Promise<object> {
  const from = daysAgo(30);
  const to   = todayEnd();

  const res = await fetch(
    `${APP_URL}/api/metrics/vendors?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    { headers: { "x-prism-org": orgId } },
  ).catch(() => null);

  if (!res?.ok) {
    return { text: "⚠️ Could not fetch spend data. Please check the dashboard." };
  }

  const json   = await res.json() as { data?: ProviderSpend[] };
  const vendors = json.data ?? [];
  return buildSpendBlocks(vendors, from, to, orgName);
}

export async function handleUnknown(text: string): Promise<object> {
  return {
    text: `Unknown command: \`/prism ${text}\``,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Available commands:*\n• \`/prism budget\` — Show this month's budget status\n• \`/prism spend\` — Show LLM spend by provider (last 30 days)\n• \`/prism approve <request-id>\` — Approve a model governance request`,
        },
      },
    ],
  };
}
