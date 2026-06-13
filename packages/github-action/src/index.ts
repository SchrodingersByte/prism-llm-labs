import * as core from "@actions/core";
import * as github from "@actions/github";

// Marker used to find and update existing bot comments
const COMMENT_MARKER = "<!-- prism-cost-report -->";

interface BranchSpend {
  branch:         string;
  commit_sha:     string;
  cost_usd:       number;
  requests:       number;
  total_tokens:   number;
  avg_latency_ms: number;
}

interface CompareResponse {
  period: { from: string; to: string; days: number };
  head:   BranchSpend;
  base:   BranchSpend;
  delta: {
    cost_usd:        number;
    requests:        number;
    total_tokens:    number;
    avg_latency_ms:  number;
    cost_pct_change: number | null;
  };
}

function fmt(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function fmtCost(usd: number): string {
  if (Math.abs(usd) >= 1000) return `$${(usd / 1000).toFixed(2)}K`;
  return `$${usd.toFixed(4)}`;
}

function fmtDelta(n: number, unit = ""): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${fmt(n)}${unit}`;
}

function fmtPct(pct: number | null): string {
  if (pct === null) return "N/A";
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function trendIcon(delta: number): string {
  if (delta > 0)  return "🔴";
  if (delta < 0)  return "🟢";
  return "⚪";
}

function buildComment(data: CompareResponse, headBranch: string, baseBranch: string): string {
  const { head, base, delta, period } = data;

  const avgCostHead = head.requests > 0 ? head.cost_usd / head.requests : 0;
  const avgCostBase = base.requests > 0 ? base.cost_usd / base.requests : 0;
  const avgDelta    = avgCostHead - avgCostBase;

  return `${COMMENT_MARKER}
## 🔍 Prism LLM Cost Report

| Metric | This PR (\`${headBranch}\`) | Base (\`${baseBranch}\`) | Delta |
|--------|----------------------|---------------|-------|
| Total Cost | ${fmtCost(head.cost_usd)} | ${fmtCost(base.cost_usd)} | ${trendIcon(delta.cost_usd)} ${fmtCost(delta.cost_usd)} (${fmtPct(delta.cost_pct_change)}) |
| Requests | ${head.requests.toLocaleString()} | ${base.requests.toLocaleString()} | ${fmtDelta(delta.requests)} |
| Avg Cost/Request | ${fmtCost(avgCostHead)} | ${fmtCost(avgCostBase)} | ${trendIcon(avgDelta)} ${fmtCost(avgDelta)} |
| Total Tokens | ${head.total_tokens.toLocaleString()} | ${base.total_tokens.toLocaleString()} | ${fmtDelta(delta.total_tokens)} |
| Avg Latency | ${fmt(head.avg_latency_ms, 0)}ms | ${fmt(base.avg_latency_ms, 0)}ms | ${fmtDelta(delta.avg_latency_ms, "ms")} |

_Last ${period.days} days · [View in Prism Dashboard](${process.env.PRISM_API_URL ?? "https://useprism.dev"}/dashboard/models)_`;
}

async function run(): Promise<void> {
  const prismApiKey  = core.getInput("prism-api-key",       { required: true });
  const prismApiUrl  = core.getInput("prism-api-url")        || "https://useprism.dev";
  const baseBranch   = core.getInput("base-branch")          || "main";
  const daysBack     = parseInt(core.getInput("days-back") || "30", 10);
  const failOnReg    = core.getInput("fail-on-regression")  === "true";
  const threshold    = parseFloat(core.getInput("cost-threshold-usd") || "0");

  const ctx     = github.context;
  const payload = ctx.payload;

  // Only run on pull_request events
  if (ctx.eventName !== "pull_request") {
    core.info("Not a pull_request event — skipping.");
    return;
  }

  const headBranch = (payload.pull_request?.head?.ref as string | undefined)
    ?? process.env.GITHUB_HEAD_REF
    ?? "";

  if (!headBranch) {
    core.warning("Could not determine PR branch name.");
    return;
  }

  const prNumber = payload.pull_request?.number as number | undefined;
  const repoOwner = ctx.repo.owner;
  const repoName  = ctx.repo.repo;

  core.info(`Comparing ${headBranch} vs ${baseBranch} over last ${daysBack} days…`);

  // Fetch comparison data from Prism API
  const url = `${prismApiUrl}/api/metrics/branches/compare?branch=${encodeURIComponent(headBranch)}&base=${encodeURIComponent(baseBranch)}&days=${daysBack}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${prismApiKey}` },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    core.setFailed(`Prism API error ${response.status}: ${text}`);
    return;
  }

  const data = (await response.json()) as CompareResponse;
  core.info(`Head cost: ${fmtCost(data.head.cost_usd)} | Base cost: ${fmtCost(data.base.cost_usd)} | Delta: ${fmtCost(data.delta.cost_usd)}`);

  // Set outputs
  core.setOutput("head-cost-usd", String(data.head.cost_usd));
  core.setOutput("base-cost-usd", String(data.base.cost_usd));
  core.setOutput("delta-cost-usd", String(data.delta.cost_usd));

  // Post / update comment on the PR
  if (prNumber && process.env.GITHUB_TOKEN) {
    const octokit = github.getOctokit(process.env.GITHUB_TOKEN);
    const body    = buildComment(data, headBranch, baseBranch);

    // Look for existing Prism comment to update
    const { data: comments } = await octokit.rest.issues.listComments({
      owner:      repoOwner,
      repo:       repoName,
      issue_number: prNumber,
    });

    const existing = comments.find(c => c.body?.includes(COMMENT_MARKER));

    if (existing) {
      await octokit.rest.issues.updateComment({
        owner:      repoOwner,
        repo:       repoName,
        comment_id: existing.id,
        body,
      });
      core.info(`Updated existing Prism cost comment #${existing.id}`);
    } else {
      await octokit.rest.issues.createComment({
        owner:        repoOwner,
        repo:         repoName,
        issue_number: prNumber,
        body,
      });
      core.info("Created Prism cost comment on PR");
    }
  }

  // Fail the step if regression is detected and threshold is exceeded
  if (failOnReg && data.delta.cost_usd > threshold) {
    core.setFailed(
      `LLM cost regression: ${fmtCost(data.head.cost_usd)} (this PR) vs ${fmtCost(data.base.cost_usd)} (base). ` +
      `Delta ${fmtCost(data.delta.cost_usd)} exceeds threshold ${fmtCost(threshold)}.`,
    );
  }
}

run().catch(err => core.setFailed((err as Error).message));
