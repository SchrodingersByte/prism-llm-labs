/**
 * One-time setup: links a GitHub repo to the Developer Tools project in Prism.
 *
 * Creates a stub github_connections row (no real OAuth token needed —
 * Prism only uses this for branch enforcement, not API calls) then a
 * project_github_repos row linking the repo to the project.
 *
 * Once connected:
 *   - The ingest route enforces x-prism-branch on all events for this project
 *   - The gateway enforces x-prism-branch header in gateway mode
 *   - Branch spend appears in /dashboard/projects → Developer Tools
 *
 * Usage:
 *   GITHUB_REPO_OWNER=your-github-username \
 *   GITHUB_REPO_NAME=prism-test-agent \
 *   ts-node --project scripts/e2e/tsconfig.json scripts/e2e/live/connect-github-repo.ts
 */

require("dotenv").config({ path: ".env.e2e" });

import { createClient }       from "@supabase/supabase-js";
import { randomBytes, createCipheriv } from "crypto";

const SUPABASE_URL         = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ENCRYPTION_SECRET    = process.env.ENCRYPTION_SECRET!;
const USER_EMAIL           = "dip.dey2112@gmail.com";

const REPO_OWNER = process.env.GITHUB_REPO_OWNER ?? "";
const REPO_NAME  = process.env.GITHUB_REPO_NAME  ?? "prism-test-agent";

if (!REPO_OWNER) {
  console.error("[connect-github] Set GITHUB_REPO_OWNER=your-github-username in env");
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY) as any;

function encryptKey(plaintext: string): string {
  const secret    = Buffer.from(ENCRYPTION_SECRET, "hex");
  const iv        = randomBytes(16);
  const cipher    = createCipheriv("aes-256-cbc", secret, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
}

async function getRepoId(owner: string, repo: string): Promise<number> {
  // GitHub's public API — no auth required for public repos
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "prism-test-agent" },
  });

  if (res.ok) {
    const data = await res.json() as { id: number };
    return data.id;
  }

  // Private repo or not yet created — use a deterministic stub ID
  console.warn(`[connect-github] Could not fetch repo metadata (${res.status}) — using stub repo_id. Create the repo first for real ID.`);
  return Math.abs(Buffer.from(`${owner}/${repo}`).reduce((a, b) => a + b, 0)) + 1_000_000;
}

async function run() {
  // ── Resolve user + org ────────────────────────────────────────────────────
  const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = users.find((u: { email?: string }) => u.email === USER_EMAIL);
  if (!user) { console.error(`[connect-github] User ${USER_EMAIL} not found`); process.exit(1); }

  const { data: memberRow } = await admin.from("members").select("org_id").eq("user_id", user.id).maybeSingle();
  const orgId  = memberRow.org_id as string;
  const userId = user.id as string;

  // ── Find Developer Tools project ──────────────────────────────────────────
  const { data: projRow } = await admin.from("projects")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("slug", "developer-tools")
    .maybeSingle();

  if (!projRow) {
    console.error("[connect-github] 'developer-tools' project not found. Run seed-demo.ts first.");
    process.exit(1);
  }
  const projectId = projRow.id as string;
  console.log(`[connect-github] Project: ${projRow.name} (${projectId})`);

  // ── Check if already connected ────────────────────────────────────────────
  const { data: existing } = await admin.from("project_github_repos")
    .select("id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing) {
    console.log("[connect-github] Repository already connected to this project. Nothing to do.");
    return;
  }

  // ── Get real repo ID from GitHub API ──────────────────────────────────────
  console.log(`[connect-github] Fetching repo metadata: ${REPO_OWNER}/${REPO_NAME}`);
  const repoId = await getRepoId(REPO_OWNER, REPO_NAME);
  console.log(`[connect-github] Repo ID: ${repoId}`);

  // ── Create stub github_connections row ────────────────────────────────────
  // access_token is encrypted but unused — branch enforcement only checks row existence.
  const stubToken = encryptKey("stub-no-real-token");
  const { data: connRow, error: connErr } = await admin.from("github_connections").upsert(
    {
      org_id:         orgId,
      user_id:        userId,
      access_token:   stubToken,
      github_login:   REPO_OWNER,
      github_user_id: repoId % 2147483647,  // fit in integer range
      scope:          "repo",
    },
    { onConflict: "org_id,github_user_id", ignoreDuplicates: false },
  ).select("id").single();

  if (connErr) {
    console.error("[connect-github] github_connections insert failed:", connErr.message);
    process.exit(1);
  }
  const connectionId = connRow.id as string;
  console.log(`[connect-github] github_connections: ${connectionId}`);

  // ── Link repo to project ──────────────────────────────────────────────────
  const { error: repoErr } = await admin.from("project_github_repos").insert({
    project_id:     projectId,
    connection_id:  connectionId,
    repo_owner:     REPO_OWNER,
    repo_name:      REPO_NAME,
    repo_id:        repoId,
    default_branch: "main",
    is_private:     false,
  });

  if (repoErr) {
    console.error("[connect-github] project_github_repos insert failed:", repoErr.message);
    process.exit(1);
  }

  console.log(`[connect-github] Done! ${REPO_OWNER}/${REPO_NAME} → Developer Tools project`);
  console.log("[connect-github] Branch enforcement is now active for this project.");
  console.log("[connect-github] All API calls to this project must include x-prism-branch header.");
  console.log(`[connect-github] The agent.ts script does this automatically via git context detection.`);
}

run().catch((err) => {
  console.error("[connect-github] Fatal:", err);
  process.exit(1);
});
