/**
 * Git context detection — works in both ESM and CJS Node.js environments.
 *
 * Uses a static import of child_process (tsup handles CJS/ESM compilation),
 * wrapped in try-catch so it degrades gracefully in browser/edge runtimes
 * where child_process is unavailable.
 */

// Static import — tsup compiles this correctly for both ESM and CJS output.
// The try-catch around each call handles environments without child_process.
import { execSync } from "child_process";

function gitCmd(cmd: string): string {
  try {
    // 2 s timeout — git can be slow on Windows or network drives on cold start
    return execSync(cmd, {
      stdio:   ["pipe", "pipe", "pipe"],
      timeout: 2000,
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

/**
 * Detect git context: branch, commit SHA, and developer identity.
 *
 * Priority order:
 *   1. Explicit env vars (CI or user-set)
 *   2. git subprocess (auto-detect from working directory)
 *
 * Called fresh on every OpenAI() instantiation so that the simulate-branches
 * pattern (set process.env.GITHUB_REF_NAME, create new client) picks up
 * the updated value each time.
 */
export function detectGitContext(): Record<string, string> {
  const ctx: Record<string, string> = {};

  const branch =
    process.env["GITHUB_REF_NAME"] ??
    process.env["GIT_BRANCH"]      ??
    process.env["BRANCH_NAME"]     ??
    gitCmd("git rev-parse --abbrev-ref HEAD");

  const commit = (
    process.env["GITHUB_SHA"] ??
    process.env["GIT_COMMIT"] ??
    gitCmd("git rev-parse --short HEAD")
  )?.slice(0, 7);

  // Developer identity — git config user.email / user.name
  // PRISM_DEVELOPER_* env vars let users override (useful in shared CI envs)
  const authorEmail =
    process.env["GIT_AUTHOR_EMAIL"]    ??
    process.env["PRISM_DEVELOPER_EMAIL"] ??
    gitCmd("git config user.email");

  const authorName =
    process.env["GIT_AUTHOR_NAME"]    ??
    process.env["PRISM_DEVELOPER_NAME"] ??
    gitCmd("git config user.name")  ??
    process.env["GITHUB_ACTOR"];       // CI fallback: GitHub Actions actor

  if (branch && branch !== "HEAD") ctx["git_branch"]        = branch;
  if (commit)                       ctx["git_commit"]        = commit;
  if (authorEmail)                  ctx["git_author_email"]  = authorEmail;
  if (authorName)                   ctx["git_author_name"]   = authorName;
  return ctx;
}
