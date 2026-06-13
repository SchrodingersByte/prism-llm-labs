/**
 * GET /api/metrics/branch-developers
 * Returns per-branch, per-developer token/cost breakdown.
 * Enriches Tinybird data with:
 *   - commit_author (GitHub login) from github_repo_branches
 *   - pr_number / pr_title from github_repo_branches
 *   - display_name resolved via github_connections
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { getSpendByBranchDeveloper } from "@/lib/tinybird/queries";
import { checkFeature } from "@/lib/billing/feature-guard";
import { z } from "zod";

function thirtyDaysAgo() {
  const d = new Date(); d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10) + " 00:00:00";
}
function today() { return new Date().toISOString().slice(0, 10) + " 23:59:59"; }

const QuerySchema = z.object({
  from:       z.string().default(thirtyDaysAgo),
  to:         z.string().default(today),
  project_id: z.string().uuid().optional(),
  key_type:   z.enum(["analytics", "gateway"]).optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const guard = await checkFeature(ctx.orgId, "branch_attribution");
  if (guard) return guard;

  const params = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!params.success) return NextResponse.json({ error: "Invalid params" }, { status: 400 });

  try {
    // 1. Get raw branch Ã— developer spend from Tinybird
    const rows = await getSpendByBranchDeveloper(
      ctx.orgId,
      params.data.from,
      params.data.to,
      params.data.project_id,
      params.data.key_type,
    );

    if (rows.length === 0) return NextResponse.json({ data: [] });

    const admin = createAdminClient();

    // 2. Load github_repo_branches for this org's linked repos to get commit_author + PR info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: linkedRepos } = await (admin as any)
      .from("project_github_repos" as any)
      .select("repo_id")
      .in(
        "connection_id",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ((await (admin as any)
          .from("github_connections")
          .select("id")
          .eq("org_id", ctx.orgId)
        ).data ?? []).map((c: { id: string }) => c.id),
      ) as { data: { repo_id: number }[] | null };

    const repoIds = (linkedRepos ?? []).map(r => r.repo_id);

    // branch_name â†’ { commit_author, pr_number, pr_title }
    type BranchMeta = { commit_author: string | null; pr_number: number | null; pr_title: string | null };
    const branchMeta = new Map<string, BranchMeta>();

    if (repoIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: branches } = await (admin as any)
        .from("github_repo_branches")
        .select("branch_name, commit_author, pr_number, pr_title")
        .in("repo_id", repoIds) as {
          data: { branch_name: string; commit_author: string | null; pr_number: number | null; pr_title: string | null }[] | null
        };

      for (const b of branches ?? []) {
        branchMeta.set(b.branch_name, {
          commit_author: b.commit_author,
          pr_number: b.pr_number,
          pr_title: b.pr_title,
        });
      }
    }

    // 3. Build github_login â†’ display_name map via github_connections
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: connections } = await (admin as any)
      .from("github_connections")
      .select("github_login, user_id")
      .eq("org_id", ctx.orgId) as { data: { github_login: string; user_id: string }[] | null };

    // github_login â†’ user_id (for any future display name resolution)
    const loginToUserId = new Map(
      (connections ?? []).map(c => [c.github_login, c.user_id]),
    );

    // 4. Enrich each row
    const enriched = rows.map(row => {
      const meta = branchMeta.get(row.branch);
      const commitAuthor = meta?.commit_author ?? null;
      return {
        ...row,
        commit_author: commitAuthor,
        pr_number:     meta?.pr_number  ?? null,
        pr_title:      meta?.pr_title   ?? null,
        // developer_user_id: resolve GitHub login â†’ Prism user_id if available
        developer_user_id: commitAuthor ? (loginToUserId.get(commitAuthor) ?? null) : null,
      };
    });

    return NextResponse.json({ data: enriched });
  } catch (e) {
    console.error("branch-developers metrics error:", e);
    return NextResponse.json({ error: "Failed to fetch branch developer metrics" }, { status: 500 });
  }
}
