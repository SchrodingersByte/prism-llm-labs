/**
 * POST /api/github/webhook
 * Receives GitHub push and pull_request events; keeps github_repo_branches
 * up to date with the latest commit author and PR metadata.
 *
 * Configure in GitHub: Settings â†’ Webhooks â†’ Add webhook
 *   Payload URL: https://useprism.dev/api/github/webhook
 *   Content type: application/json
 *   Secret: GITHUB_WEBHOOK_SECRET env var value
 *   Events: Pushes, Pull requests
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { processOutcomeRules } from "@/lib/outcomes/rules";

function verifySignature(body: string, signature: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const rawBody  = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event     = req.headers.get("x-github-event");
  const payload   = JSON.parse(rawBody);

  if (event === "push") {
    await handlePush(payload);
  } else if (event === "pull_request") {
    await handlePullRequest(payload);
  }
  // Other events (ping, etc.) are acknowledged but ignored

  return NextResponse.json({ ok: true });
}

interface PushPayload {
  ref: string;  // "refs/heads/feat/ai-search"
  after: string; // commit SHA
  repository: { id: number };
  head_commit: { id: string; timestamp: string } | null;
  pusher: { name: string };
  sender: { login: string };
}

async function handlePush(payload: PushPayload) {
  const ref = payload.ref;
  if (!ref.startsWith("refs/heads/")) return; // ignore tag pushes

  const branchName  = ref.replace("refs/heads/", "");
  const repoId      = payload.repository.id;
  const commitSha   = payload.after;
  const commitDate  = payload.head_commit?.timestamp ?? new Date().toISOString();
  // Prefer sender login (the GitHub user who pushed) over pusher name
  const commitAuthor = payload.sender?.login ?? payload.pusher?.name ?? null;

  const supabase = createAdminClient();

  // Deleted branch (all-zeros SHA) â€” remove the row
  if (/^0+$/.test(commitSha)) {
    await supabase
      .from("github_repo_branches")
      .delete()
      .eq("repo_id", repoId)
      .eq("branch_name", branchName);
    return;
  }

  await supabase
    .from("github_repo_branches")
    .upsert(
      {
        repo_id:       repoId,
        branch_name:   branchName,
        commit_sha:    commitSha.slice(0, 40),
        commit_author: commitAuthor,
        commit_date:   commitDate,
        synced_at:     new Date().toISOString(),
      },
      { onConflict: "repo_id,branch_name" },
    );
}

interface PullRequestPayload {
  action: string;
  number: number;
  pull_request: {
    title: string;
    head: { ref: string; sha: string };
    merged_at: string | null;
  };
  repository: { id: number };
}

async function handlePullRequest(payload: PullRequestPayload) {
  const { action, number: prNumber, pull_request: pr, repository } = payload;

  // Only care about open/update/merge lifecycle events
  if (!["opened", "synchronize", "reopened", "closed"].includes(action)) return;

  const repoId     = repository.id;
  const branchName = pr.head.ref;
  const supabase   = createAdminClient();

  if (action === "closed" && pr.merged_at) {
    // Branch merged â€” clear PR metadata but keep branch row (commit data still useful)
    await supabase
      .from("github_repo_branches")
      .update({ pr_number: null, pr_title: null, synced_at: new Date().toISOString() })
      .eq("repo_id", repoId)
      .eq("branch_name", branchName);

    // Auto-detect outcome for orgs with github_pr_merge rules configured
    const orgId = await getOrgForRepo(supabase, repoId);
    if (orgId) {
      void processOutcomeRules(
        "github_pr_merge",
        payload as unknown as Record<string, unknown>,
        orgId,
      );
    }
    return;
  }

  // opened / synchronize / reopened â€” upsert with latest PR info
  await supabase
    .from("github_repo_branches")
    .upsert(
      {
        repo_id:     repoId,
        branch_name: branchName,
        commit_sha:  pr.head.sha.slice(0, 40),
        pr_number:   prNumber,
        pr_title:    pr.title,
        synced_at:   new Date().toISOString(),
      },
      { onConflict: "repo_id,branch_name" },
    );
}

/** Resolve the Prism org_id for a given GitHub repo ID (via project_github_repos). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrgForRepo(supabase: any, repoId: number): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("project_github_repos" as any)
      .select("projects(org_id)")
      .eq("github_repo_id", repoId)
      .limit(1)
      .maybeSingle() as { data: { projects: { org_id: string } | null } | null };
    return data?.projects?.org_id ?? null;
  } catch {
    return null;
  }
}
