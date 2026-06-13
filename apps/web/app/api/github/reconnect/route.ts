/**
 * GET /api/github/reconnect
 *
 * Revokes the existing GitHub OAuth token (so GitHub re-prompts with fresh
 * permissions), deletes all DB records, and redirects to the installation flow.
 * This forces the user through the repo picker again so they can select
 * "All repositories" (including private ones).
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/crypto/keys";
import { revokeOAuthToken } from "@/lib/github/app";

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const returnTo = req.nextUrl.searchParams.get("return_to")
    ?? "/dashboard/settings/connections";

  const admin = createAdminClient();

  // Check scm_connections first, then fall back to legacy table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scmConn } = await (admin as any)
    .from("scm_connections")
    .select("id, access_token")
    .eq("org_id", ctx.orgId)
    .eq("provider", "github")
    .maybeSingle() as { data: { id: string; access_token: string } | null };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: legacyConn } = await (admin as any)
    .from("github_connections")
    .select("id, access_token")
    .eq("org_id", ctx.orgId)
    .maybeSingle() as { data: { id: string; access_token: string } | null };

  const conn = scmConn ?? legacyConn;

  if (conn) {
    // Revoke the OAuth token â€” non-fatal if it fails
    try {
      await revokeOAuthToken(decryptKey(conn.access_token));
    } catch { /* ignore */ }

    // Clean up repo links and branches
    const repoQuery = scmConn
      ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any).from("project_repos").select("repo_id").eq("connection_id", conn.id)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (admin as any).from("project_github_repos" as any).select("repo_id").eq("connection_id", conn.id);

    const { data: repos } = await repoQuery as { data: { repo_id: number }[] | null };

    if ((repos ?? []).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any)
        .from("github_repo_branches")
        .delete()
        .in("repo_id", (repos ?? []).map(r => r.repo_id));
    }

    // Delete from both tables (migration window)
    await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from("project_repos").delete().eq("connection_id", conn.id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from("project_github_repos" as any).delete().eq("connection_id", conn.id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from("scm_connections").delete().eq("id", conn.id),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (admin as any).from("github_connections").delete().eq("id", conn.id),
    ]);
  }

  // Redirect to the installation flow â€” forces repo picker + fresh auth
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_APP_URL}/api/github/connect?return_to=${encodeURIComponent(returnTo)}`,
  );
}
