/**
 * WS3/WS5 gate-helper matrix: isOrgManager, canWriteOrg, getAccessibleProjectIds.
 * These are the functions the governance/content/finance write routes delegate to,
 * so verifying them across all 4 roles + project scope covers the app-layer gate
 * logic (the RLS equivalents were verified live in verify_ws2.mjs).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/supabase/auth";

const mockFrom = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFrom }),
}));

// Chainable query stub: every builder method returns the chain; terminal
// reads (maybeSingle / await) resolve to { data }.
function chain(data: unknown) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit", "not", "range"]) c[m] = () => c;
  c.maybeSingle = async () => ({ data });
  c.single = async () => ({ data });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (c as any).then = (resolve: (v: unknown) => unknown) => resolve({ data });
  return c;
}

/** Mock the members row (role/scope/id) and optional member_project_roles + projects rows. */
function setup(opts: {
  member: { id?: string; role: string | null; scope_type: string } | null;
  grants?: Array<{ project_id: string }>;
  projects?: Array<{ id: string }>;
}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "members") return chain(opts.member);
    if (table === "member_project_roles") return chain(opts.grants ?? []);
    if (table === "projects") return chain(opts.projects ?? []);
    return chain(null);
  });
}

const ORG = "org-1";
const ctxFor = (scopeType: "organization" | "project"): AuthContext => ({
  user: { id: "u1" } as AuthContext["user"],
  orgId: ORG,
  scopeType,
  role: null,
  isOwner: false, isAdministrator: false, isDeveloper: false, isReadOnly: false,
  isAdmin: false, canManage: false, canWrite: false,
});

beforeEach(() => vi.clearAllMocks());

describe("isOrgManager()", () => {
  const cases: Array<[string, string | null, string, boolean]> = [
    ["owner",         "owner",         "organization", true],
    ["administrator", "administrator", "organization", true],
    ["developer",     "developer",     "organization", false],
    ["read_only",     "read_only",     "organization", false],
    ["project-scoped", null,           "project",      false],
  ];
  it.each(cases)("%s → %s", async (_label, role, scope_type, expected) => {
    setup({ member: { role, scope_type } });
    const { isOrgManager } = await import("@/lib/supabase/metrics-scope");
    expect(await isOrgManager("u1", ORG)).toBe(expected);
  });

  it("non-member → false", async () => {
    setup({ member: null });
    const { isOrgManager } = await import("@/lib/supabase/metrics-scope");
    expect(await isOrgManager("u1", ORG)).toBe(false);
  });
});

describe("canWriteOrg()", () => {
  const cases: Array<[string, string | null, string, boolean]> = [
    ["owner",         "owner",         "organization", true],
    ["administrator", "administrator", "organization", true],
    ["developer",     "developer",     "organization", true],
    ["read_only",     "read_only",     "organization", false],   // the key read_only exclusion
    ["project-scoped", null,           "project",      false],
  ];
  it.each(cases)("%s → %s", async (_label, role, scope_type, expected) => {
    setup({ member: { role, scope_type } });
    const { canWriteOrg } = await import("@/lib/supabase/metrics-scope");
    expect(await canWriteOrg("u1", ORG)).toBe(expected);
  });
});

describe("getAccessibleProjectIds()", () => {
  it("org-scoped (any role) → null (sees all projects)", async () => {
    setup({ member: { id: "m1", role: "read_only", scope_type: "organization" } });
    const { getAccessibleProjectIds } = await import("@/lib/supabase/metrics-scope");
    expect(await getAccessibleProjectIds(ctxFor("organization"))).toBeNull();
  });

  it("project-scoped → only granted project ids", async () => {
    setup({
      member:   { id: "m1", role: null, scope_type: "project" },
      grants:   [{ project_id: "p1" }, { project_id: "p2" }],
      projects: [{ id: "p1" }, { id: "p2" }],   // clamp to org
    });
    const { getAccessibleProjectIds } = await import("@/lib/supabase/metrics-scope");
    expect(await getAccessibleProjectIds(ctxFor("project"))).toEqual(["p1", "p2"]);
  });

  it("project-scoped with no grants → empty array", async () => {
    setup({ member: { id: "m1", role: null, scope_type: "project" }, grants: [], projects: [] });
    const { getAccessibleProjectIds } = await import("@/lib/supabase/metrics-scope");
    expect(await getAccessibleProjectIds(ctxFor("project"))).toEqual([]);
  });
});
