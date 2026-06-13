/**
 * Slack Web API client factory.
 * Returns a client initialized with the decrypted bot token for the org.
 */
import { WebClient } from "@slack/web-api";
import { createAdminClient } from "@/lib/supabase/server";
import { decryptKey } from "@/lib/crypto/keys";

export async function getSlackClient(orgId: string): Promise<WebClient | null> {
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("slack_installations")
    .select("bot_token")
    .eq("org_id", orgId)
    .maybeSingle() as { data: { bot_token: string } | null };

  if (!data) return null;
  const token = decryptKey(data.bot_token);
  return new WebClient(token);
}
