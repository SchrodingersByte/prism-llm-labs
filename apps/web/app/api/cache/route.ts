import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { invalidateOrgCache } from "@/lib/gateway/cache";
import { semanticCacheInvalidate } from "@/lib/gateway/semantic-cache";

/**
 * DELETE /api/cache — purge the org's prompt cache (owner / admin only).
 *
 * Clears both tiers: the exact-match entries in Redis (`prompt_cache:{org}:*`)
 * and the semantic entries in the vector store (scoped by `org_id`). Use after
 * changing a prompt/system message, a pricing correction, or any time stale
 * cached answers must be flushed.
 */
export async function DELETE() {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org membership" }, { status: 403 });

  const admin = createAdminClient();

  // Only owners and admins may flush the cache (destructive, org-wide).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members")
    .select("role")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string } | null };

  if (!["owner", "administrator"].includes(memberRow?.role ?? "")) {
    return NextResponse.json({ error: "Only owners and admins can clear the cache" }, { status: 403 });
  }

  const [exactDeleted, semanticCleared] = await Promise.all([
    invalidateOrgCache(member.org_id),
    semanticCacheInvalidate(member.org_id),
  ]);

  await writeAuditLog({
    orgId: member.org_id, actorUserId: user.id,
    action: "cache.cleared", targetType: "organization", targetId: member.org_id,
    metadata: { exact_entries_deleted: exactDeleted, semantic_cleared: semanticCleared },
  });

  return NextResponse.json({ success: true, exactEntriesDeleted: exactDeleted, semanticCleared });
}
