import { createClient } from "@supabase/supabase-js";

type AuditAction =
  | "key.created"
  | "key.revoked"
  | "key.assigned"
  | "key.expired"
  | "provider.connected"
  | "provider.updated"
  | "provider.deleted"
  | "member.invited"
  | "member.joined"
  | "member.removed"
  | "member.role_changed"
  | "org.updated"
  | "org.ownership_transferred"
  | "key.updated"
  | "key.unassigned"
  | "model_policy.created"
  | "model_policy.deleted"
  | "model_approval.approved"
  | "model_approval.rejected"
  | "recommendation.activated"
  | "recommendation.rolled_back"
  | "recommendation.rejected"
  | "recommendation.reconsidered"
  | "cache.cleared";

interface AuditParams {
  orgId:       string;
  actorUserId: string;
  action:      AuditAction;
  targetType?: "api_key" | "provider_key" | "member" | "project" | "organization"
             | "org_model_policy" | "model_approval_request" | "recommendation_action";
  targetId?:   string;
  metadata?:   Record<string, unknown>;
}

function getAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await getAdmin().from("audit_log").insert({
      org_id:        params.orgId,
      actor_user_id: params.actorUserId,
      action:        params.action,
      target_type:   params.targetType ?? null,
      target_id:     params.targetId ?? null,
      metadata:      params.metadata ?? {},
    });
  } catch {
    // Audit log writes must never break the primary operation
  }
}
