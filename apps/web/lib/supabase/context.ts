import { NextResponse } from "next/server";
import { createAdminClient } from "./server";
import { requireAuth, type AuthContext, type OrgRole } from "./auth";

export interface AccountContext {
  id:         string;
  name:       string;
  slug:       string;
  plan:       string;
  role:       "owner" | "admin";
  ssoEnabled: boolean;
}

export interface MemberContext extends AuthContext {
  account?: AccountContext;
}

interface GetMemberContextOptions {
  roles?:          OrgRole[];
  requireAccount?: boolean;
}

/**
 * Extends requireAuth() with account-layer context.
 * Looks up whether the user's org belongs to an enterprise account
 * and whether the user is an account-level member.
 */
export async function getMemberContext(
  options?: GetMemberContextOptions,
): Promise<MemberContext | NextResponse> {
  const ctx = await requireAuth({ roles: options?.roles });
  if (ctx instanceof NextResponse) return ctx;

  const admin = createAdminClient();

  // Find the account linked to the active org (may be null for standalone orgs)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations")
    .select("account_id")
    .eq("id", ctx.orgId)
    .maybeSingle() as { data: { account_id: string | null } | null };

  const accountId = org?.account_id ?? null;

  if (!accountId) {
    if (options?.requireAccount) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    return { ...ctx };
  }

  // Check if this user is an account_member
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: accountMember } = await (admin as any)
    .from("account_members")
    .select("role, accounts(id, name, slug, plan, sso_enabled)")
    .eq("account_id", accountId)
    .eq("user_id", ctx.user.id)
    .maybeSingle() as {
      data: {
        role: "owner" | "admin";
        accounts: { id: string; name: string; slug: string; plan: string; sso_enabled: boolean };
      } | null;
    };

  if (!accountMember) {
    if (options?.requireAccount) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return { ...ctx };
  }

  const { accounts: acct, role: accountRole } = accountMember;

  return {
    ...ctx,
    account: {
      id:         acct.id,
      name:       acct.name,
      slug:       acct.slug,
      plan:       acct.plan,
      role:       accountRole,
      ssoEnabled: acct.sso_enabled,
    },
  };
}
