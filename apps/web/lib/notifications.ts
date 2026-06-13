import { createAdminClient } from "./supabase/server";

interface CreateNotificationParams {
  userId:     string;
  orgId?:     string;
  type:       string;
  title:      string;
  body?:      string;
  actionUrl?: string;
  metadata?:  Record<string, unknown>;
}

/**
 * Fire-and-forget notification creator. Never throws — observability
 * must not break the calling operation.
 */
export async function createNotification(params: CreateNotificationParams): Promise<void> {
  try {
    const admin = createAdminClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from("notifications").insert({
      user_id:    params.userId,
      org_id:     params.orgId ?? null,
      type:       params.type,
      title:      params.title,
      body:       params.body ?? null,
      action_url: params.actionUrl ?? null,
      metadata:   params.metadata ?? {},
      is_read:    false,
    });
  } catch (err) {
    console.error("[notifications] Failed to create notification:", err);
  }
}
