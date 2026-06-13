/**
 * GET  /api/github/repos            â€” list repos accessible via connected GitHub account
 * POST /api/github/repos            â€” link a repo to a project
 * DELETE /api/github/repos?repo_id= â€” unlink a repo
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/supabase/auth";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/crypto/keys";
import { getInstallationToken } from "@/lib/github/app";
import { z } from "zod";

const LinkSchema = z.object({
  project_id:     z.string().uuid(),
  repo_id:        z.number().int(),
  repo_owner:     z.string(),
  repo_name:      z.string(),
  default_branch: z.string().default("main"),
  is_private:     z.boolean().default(false),
  // connection_id is optional â€” defaults to the org's first scm_connections row
  connection_id:  z.string().uuid().optional(),
});

/** Resolve a GitHub bearer token â€” installation token if available, else user OAuth token. */
async function resolveGitHubToken(conn: {
  access_token: string;
  installation_id: string | null;
}): Promise<string> {
  if (conn.installation_id) {
    try {
      const { token } = await getInstallationToken(conn.installation_id);
      return token;
    } catch (e) {
      console.warn("Installation token failed, falling back to user OAuth token:", e);
    }
  }
  return decryptKey(conn.access_token);
}

export async function GET(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // Support optional ?connection_id= to target a specific account when an org
  // has multiple GitHub connections (e.g. personal + company GitHub accounts).
  const connectionId = req.nextUrl.searchParams.get("connection_id");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from("scm_connections")
    .select("id, access_token, provider_login, installation_id, scope, needs_reconnect:scope")
    .eq("org_id", ctx.orgId)
    .eq("provider", "github");

  if (connectionId) {
    query = query.eq("id", connectionId);
  }

  const { data: conn } = await query.maybeSingle();

  if (!conn) {
    // Fall back to legacy table during migration window
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: legacyConn } = await (admin as any)
      .from("github_connections")
      .select("id, access_token, github_login, scope")
      .eq("org_id", ctx.orgId)
      .maybeSingle();
    if (!legacyConn) return NextResponse.json({ data: [], connected: false });

    // Reuse the existing logic for legacy connections
    return handleLegacyRepoFetch(req, ctx.orgId, legacyConn, admin);
  }

  const page  = req.nextUrl.searchParams.get("page") ?? "1";
  const token = await resolveGitHubToken(conn);
  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  // For installation tokens: /installation/repositories â€” returns all repos the app
  // was installed on (public + private). For user tokens: /user/repos with type=all.
  let repos: { id: number; full_name: string; name: string; owner: { login: string }; private: boolean; default_branch: string }[];
  let needsReconnect = false;
  let rawScopes = "";

  if (conn.installation_id) {
    // Installation token â€” fetch via /installation/repositories (includes ALL private repos)
    const instRes = await fetch(
      `https://api.github.com/installation/repositories?per_page=100&page=${page}`,
      { headers: ghHeaders },
    );
    if (!instRes.ok) {
      return NextResponse.json({ error: `GitHub API error (HTTP ${instRes.status})` }, { status: 502 });
    }
    const instData = await instRes.json() as { repositories: typeof repos };
    repos = instData.repositories ?? [];
    rawScopes = "installation"; // signal to frontend that this is an installation token
  } else {
    // Legacy user OAuth token â€” parallel calls for public + private
    const [ghAll, ghPrivate] = await Promise.all([
      fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&type=all`, { headers: ghHeaders }),
      fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&visibility=private`, { headers: ghHeaders }),
    ]);

    if (!ghAll.ok) {
      return NextResponse.json({ error: `GitHub API error (HTTP ${ghAll.status})` }, { status: 502 });
    }

    rawScopes = ghAll.headers.get("x-oauth-scopes") ?? "";
    const scopeList = rawScopes ? rawScopes.split(/[,\s]+/).filter(Boolean) : null;
    needsReconnect  = scopeList !== null && !scopeList.includes("repo");

    type GHRepo = typeof repos[number];
    const allRepos  = (await ghAll.json() as GHRepo[]);
    const privRepos = ghPrivate.ok ? (await ghPrivate.json() as GHRepo[]) : [];
    const seen = new Set(allRepos.map(r => r.id));
    repos = [...allRepos, ...privRepos.filter(r => !seen.has(r.id))];
  }

  const repoList = repos.map(r => ({
    id:             r.id,
    full_name:      r.full_name,
    name:           r.name,
    owner:          r.owner.login,
    is_private:     r.private,
    default_branch: r.default_branch,
  }));

  // Mark which repos are already linked to any project in this org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: linked } = await (admin as any)
    .from("project_repos")
    .select("repo_id, project_id, projects(name)")
    .eq("connection_id", conn.id);

  const linkedMap = new Map((linked ?? []).map((l: {
    repo_id: number; project_id: string; projects: { name: string };
  }) => [l.repo_id, l]));

  return NextResponse.json({
    connected:        true,
    connection_id:    conn.id,
    github_login:     conn.provider_login,
    granted_scopes:   rawScopes,
    needs_reconnect:  needsReconnect,
    has_installation: !!conn.installation_id,
    scope_hint: needsReconnect
      ? `Your GitHub token has scopes [${rawScopes}] â€” reconnect to grant repository access.`
      : null,
    data: repoList.map(r => ({ ...r, linked_to: linkedMap.get(r.id) ?? null })),
  });
}

/** Legacy fallback during migration window (github_connections table still exists). */
async function handleLegacyRepoFetch(
  req: NextRequest,
  orgId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  legacyConn: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
) {
  const token = decryptKey(legacyConn.access_token);
  const page  = req.nextUrl.searchParams.get("page") ?? "1";
  const ghHeaders = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };

  const [ghAll, ghPrivate] = await Promise.all([
    fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&type=all`, { headers: ghHeaders }),
    fetch(`https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&visibility=private`, { headers: ghHeaders }),
  ]);

  if (!ghAll.ok) return NextResponse.json({ error: "GitHub API error" }, { status: 502 });

  const rawScopes = ghAll.headers.get("x-oauth-scopes") ?? "";
  const scopeList = rawScopes ? rawScopes.split(/[,\s]+/).filter(Boolean) : null;
  const needsReconnect = scopeList !== null && !scopeList.includes("repo");

  type GHRepo = { id: number; full_name: string; name: string; owner: { login: string }; private: boolean; default_branch: string };
  const allRepos  = await ghAll.json() as GHRepo[];
  const privRepos = ghPrivate.ok ? await ghPrivate.json() as GHRepo[] : [];
  const seen = new Set(allRepos.map(r => r.id));
  const repos = [...allRepos, ...privRepos.filter(r => !seen.has(r.id))];

  const { data: linked } = await admin
    .from("project_github_repos" as any)
    .select("repo_id, project_id, projects(name)")
    .in("connection_id", [legacyConn.id]);

  const linkedMap = new Map((linked ?? []).map((l: { repo_id: number; project_id: string; projects: { name: string } }) => [l.repo_id, l]));

  return NextResponse.json({
    connected: true, github_login: legacyConn.github_login,
    granted_scopes: rawScopes, needs_reconnect: needsReconnect, has_installation: false,
    scope_hint: needsReconnect ? `Your GitHub token has scopes [${rawScopes}] â€” reconnect to grant repository access.` : null,
    data: repos.map(r => ({ id: r.id, full_name: r.full_name, name: r.name, owner: r.owner.login, is_private: r.private, default_branch: r.default_branch, linked_to: linkedMap.get(r.id) ?? null })),
  });
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = LinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  const admin = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: proj } = await (admin as any)
    .from("projects").select("id").eq("id", parsed.data.project_id).eq("org_id", ctx.orgId).maybeSingle();
  if (!proj) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Resolve connection â€” prefer specified connection_id, else org's first GitHub connection
  let connId = parsed.data.connection_id;
  if (!connId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conn } = await (admin as any)
      .from("scm_connections").select("id")
      .eq("org_id", ctx.orgId).eq("provider", "github").maybeSingle();
    if (conn) {
      connId = conn.id;
    } else {
      // Legacy fallback
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: legacyConn } = await (admin as any)
        .from("github_connections").select("id").eq("org_id", ctx.orgId).maybeSingle();
      if (!legacyConn) return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });
      // Write to legacy table during migration
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from("project_github_repos" as any).upsert({
        project_id: parsed.data.project_id, connection_id: legacyConn.id,
        repo_id: parsed.data.repo_id, repo_owner: parsed.data.repo_owner,
        repo_name: parsed.data.repo_name, default_branch: parsed.data.default_branch,
        is_private: parsed.data.is_private,
      }, { onConflict: "project_id,repo_id" });
      return NextResponse.json({ ok: true }, { status: 201 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("project_repos").upsert({
    project_id:     parsed.data.project_id,
    connection_id:  connId,
    provider:       "github",
    repo_id:        parsed.data.repo_id,
    repo_owner:     parsed.data.repo_owner,
    repo_name:      parsed.data.repo_name,
    default_branch: parsed.data.default_branch,
    is_private:     parsed.data.is_private,
  }, { onConflict: "project_id,connection_id,repo_id" });

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth();
  if (ctx instanceof NextResponse) return ctx;

  const repoId    = req.nextUrl.searchParams.get("repo_id");
  const projectId = req.nextUrl.searchParams.get("project_id");
  if (!repoId || !projectId) return NextResponse.json({ error: "repo_id and project_id required" }, { status: 400 });

  const admin = createAdminClient();
  // Delete from both tables to cover migration window
  await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("project_repos").delete()
      .eq("repo_id", parseInt(repoId, 10)).eq("project_id", projectId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from("project_github_repos" as any).delete()
      .eq("repo_id", parseInt(repoId, 10)).eq("project_id", projectId),
  ]);

  return NextResponse.json({ ok: true });
}
