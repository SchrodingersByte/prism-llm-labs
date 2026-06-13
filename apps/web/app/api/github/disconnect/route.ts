/**
 * DELETE /api/github/disconnect
 * Removes the GitHub connection for this org: deletes github_connections,
 * all project_github_repos links, and all github_repo_branches rows for
 * those repos. Historical Tinybird events are not touched.
 */
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";

export async function DELETE() {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  if (!ctx.canManage) {
    return NextResponse.json({ error: "Only owners and admins can disconnect GitHub" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Find the connection â€” check scm_connections first, fall back to legacy table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let conn: { id: string } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: scmConn } = await (admin as any)
    .from("scm_connections")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("provider", "github")
    .maybeSingle() as { data: { id: string } | null };
  conn = scmConn;

  if (!conn) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: legacyConn } = await (admin as any)
      .from("github_connections")
      .select("id")
      .eq("org_id", ctx.orgId)
      .maybeSingle() as { data: { id: string } | null };
    conn = legacyConn;
  }

  if (!conn) {
    return NextResponse.json({ error: "No GitHub connection found" }, { status: 404 });
  }

  // Collect repo IDs so we can clean up branch rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: repos } = await (admin as any)
    .from("project_github_repos" as any)
    .select("repo_id")
    .eq("connection_id", conn.id) as { data: { repo_id: number }[] | null };

  const repoIds = (repos ?? []).map(r => r.repo_id);

  // Delete branch rows
  if (repoIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from("github_repo_branches")
      .delete()
      .in("repo_id", repoIds);
  }

  // Delete projectâ€“repo links from both tables (migration window)
  await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("project_repos").delete().eq("connection_id", conn.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("project_github_repos" as any).delete().eq("connection_id", conn.id),
  ]);

  // Delete the connection from both tables
  await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("scm_connections").delete().eq("id", conn.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("github_connections").delete().eq("id", conn.id),
  ]);

  return NextResponse.json({ ok: true });
}
