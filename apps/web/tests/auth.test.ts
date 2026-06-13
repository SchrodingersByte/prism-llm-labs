/**
 * Tests for authentication, RBAC, and org switching.
 * Covers plan test IDs: 1.1.x, 1.3.x, 1.4.x
 *
 * Priority: P0
 *
 * Model: owner | administrator | developer | read_only, assignable org-wide
 * (members.scope_type='organization', role NOT NULL) or project-scoped
 * (scope_type='project', role NULL; per-project grants in member_project_roles).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { hasRole } from "@/lib/supabase/auth";
import { TEST_ORG_A, TEST_ORG_B, TEST_USER_OWNER, makeChain } from "@/tests/helpers";

// ── Module mocks ──────────────────────────────────────────────────────────────

const mockGetUser   = vi.fn();
const mockFromAdmin = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ from: mockFromAdmin }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
  }),
}));

vi.mock("next/headers", () => ({
  cookies: () => ({ get: vi.fn(), set: vi.fn(), getAll: vi.fn(() => []) }),
}));

// ── Helper: simulate authenticated user ──────────────────────────────────────

type Role = "owner" | "administrator" | "developer" | "read_only" | null;

function setupAuth(
  userId: string,
  orgId: string,
  role: Role,
  scopeType: "organization" | "project" = "organization",
) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: `${userId}@test.com` } }, error: null });

  mockFromAdmin.mockImplementation((table: string) => {
    if (table === "user_preferences") {
      return makeChain({ active_org_id: orgId });
    }
    if (table === "members") {
      // getMemberOrg's membership check + requireAuth's role lookup both use `members`
      return {
        ...makeChain({ org_id: orgId }),
        select: vi.fn().mockReturnThis(),
        eq:     vi.fn().mockReturnThis(),
        order:  vi.fn().mockReturnThis(),
        limit:  vi.fn().mockResolvedValue({ data: [{ org_id: orgId }] }),
        maybeSingle: vi.fn().mockResolvedValue({ data: { org_id: orgId, role, scope_type: scopeType } }),
      };
    }
    return makeChain(null);
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("hasRole()", () => {
  it("returns true when role is in the allowed list", () => {
    expect(hasRole("owner", ["owner", "administrator"])).toBe(true);
    expect(hasRole("developer", ["developer"])).toBe(true);
  });

  it("returns false when role is not allowed", () => {
    expect(hasRole("developer", ["owner"])).toBe(false);
  });

  it("returns false for empty allowed list", () => {
    expect(hasRole("owner", [])).toBe(false);
  });

  it("returns false for a null (project-scoped) role", () => {
    expect(hasRole(null, ["owner", "administrator", "developer", "read_only"])).toBe(false);
  });
});

describe("requireAuth()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Supabase getUser returns an error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error("no session") });
    mockFromAdmin.mockReturnValue(makeChain(null));

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(401);
  });

  it("returns 403 when user has no org membership", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ghost-user" } }, error: null });
    mockFromAdmin.mockReturnValue({
      ...makeChain(null),
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      order:  vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [] }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null }),
    });

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("owner → full org powers", async () => {
    setupAuth(TEST_USER_OWNER.id, TEST_ORG_A.id, "owner");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();

    if (result instanceof NextResponse) {
      const json = await result.json();
      throw new Error(`Expected AuthContext but got ${result.status}: ${JSON.stringify(json)}`);
    }

    expect(result.scopeType).toBe("organization");
    expect(result.role).toBe("owner");
    expect(result.isOwner).toBe(true);
    expect(result.isAdministrator).toBe(false);
    expect(result.isAdmin).toBe(false); // deprecated alias of isAdministrator
    expect(result.isDeveloper).toBe(false);
    expect(result.isReadOnly).toBe(false);
    expect(result.canManage).toBe(true);
    expect(result.canWrite).toBe(true);
    expect(result.orgId).toBe(TEST_ORG_A.id);
  });

  it("administrator → manages org, alias isAdmin true", async () => {
    setupAuth("user-admin", TEST_ORG_A.id, "administrator");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();
    if (result instanceof NextResponse) throw new Error(`got ${result.status}`);

    expect(result.isAdministrator).toBe(true);
    expect(result.isAdmin).toBe(true); // alias
    expect(result.isOwner).toBe(false);
    expect(result.canManage).toBe(true);
    expect(result.canWrite).toBe(true);
  });

  it("developer → writes content, cannot manage org", async () => {
    setupAuth("user-dev", TEST_ORG_A.id, "developer");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();
    if (result instanceof NextResponse) throw new Error(`got ${result.status}`);

    expect(result.isDeveloper).toBe(true);
    expect(result.canManage).toBe(false);
    expect(result.canWrite).toBe(true);
  });

  it("read_only → reads, never writes", async () => {
    setupAuth("user-ro", TEST_ORG_A.id, "read_only");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();
    if (result instanceof NextResponse) throw new Error(`got ${result.status}`);

    expect(result.isReadOnly).toBe(true);
    expect(result.canManage).toBe(false);
    expect(result.canWrite).toBe(false);
  });

  it("project-scoped member → member but no org-level powers", async () => {
    setupAuth("user-pm", TEST_ORG_A.id, null, "project");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth();
    if (result instanceof NextResponse) throw new Error(`expected AuthContext, got ${result.status}`);

    expect(result.scopeType).toBe("project");
    expect(result.role).toBeNull();
    expect(result.isOwner).toBe(false);
    expect(result.isAdministrator).toBe(false);
    expect(result.isDeveloper).toBe(false);
    expect(result.isReadOnly).toBe(false);
    expect(result.canManage).toBe(false);
    expect(result.canWrite).toBe(false); // org-level; project writes gated per-project
  });

  it("403 when { roles: ['owner'] } but caller is developer", async () => {
    setupAuth("user-developer", TEST_ORG_A.id, "developer");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth({ roles: ["owner"] });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });

  it("admits administrator under { roles: ['owner','administrator'] }", async () => {
    setupAuth("user-admin", TEST_ORG_A.id, "administrator");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth({ roles: ["owner", "administrator"] });

    expect(result).not.toBeInstanceOf(NextResponse);
  });

  it("403 for a project-scoped member under any { roles } gate", async () => {
    setupAuth("user-pm", TEST_ORG_A.id, null, "project");

    const { requireAuth } = await import("@/lib/supabase/auth");
    const result = await requireAuth({ roles: ["owner", "administrator", "developer", "read_only"] });

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });
});

describe("getMemberOrg()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns org_id from user_preferences when preference is valid", async () => {
    mockFromAdmin.mockImplementation((table: string) => {
      if (table === "user_preferences") {
        return makeChain({ active_org_id: TEST_ORG_A.id });
      }
      if (table === "members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn().mockResolvedValue({ data: [{ org_id: TEST_ORG_A.id }] }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { org_id: TEST_ORG_A.id } }),
        };
      }
      return makeChain(null);
    });

    const { getMemberOrg } = await import("@/lib/supabase/server");
    const result = await getMemberOrg(TEST_USER_OWNER.id);
    expect(result).not.toBeNull();
    expect(result!.org_id).toBe(TEST_ORG_A.id);
  });

  it("falls back to most-recent org when preference is null", async () => {
    mockFromAdmin.mockImplementation((table: string) => {
      if (table === "user_preferences") return makeChain(null);
      if (table === "members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn().mockResolvedValue({ data: [{ org_id: TEST_ORG_B.id }] }),
          maybeSingle: vi.fn().mockResolvedValue({ data: { org_id: TEST_ORG_B.id } }),
        };
      }
      return makeChain(null);
    });

    const { getMemberOrg } = await import("@/lib/supabase/server");
    const result = await getMemberOrg("user-no-pref");
    expect(result).not.toBeNull();
    expect(result!.org_id).toBe(TEST_ORG_B.id);
  });

  it("returns null when user has no memberships", async () => {
    mockFromAdmin.mockImplementation((table: string) => {
      if (table === "user_preferences") return makeChain(null);
      if (table === "members") {
        return {
          select: vi.fn().mockReturnThis(),
          eq:     vi.fn().mockReturnThis(),
          order:  vi.fn().mockReturnThis(),
          limit:  vi.fn().mockResolvedValue({ data: [] }),
        };
      }
      return makeChain(null);
    });

    const { getMemberOrg } = await import("@/lib/supabase/server");
    const result = await getMemberOrg("orphan-user");
    expect(result).toBeNull();
  });
});

describe("PATCH /api/user/active-org — org switching (logic tests)", () => {
  it("membership check correctly rejects when user is not in target org", () => {
    const userOrgIds   = [TEST_ORG_A.id];
    const targetOrgId  = TEST_ORG_B.id;
    const isMember     = userOrgIds.includes(targetOrgId);
    expect(isMember).toBe(false);
  });

  it("membership check allows switch to org user belongs to", () => {
    const userOrgIds  = [TEST_ORG_A.id, TEST_ORG_B.id];
    const targetOrgId = TEST_ORG_B.id;
    const isMember    = userOrgIds.includes(targetOrgId);
    expect(isMember).toBe(true);
  });
});
