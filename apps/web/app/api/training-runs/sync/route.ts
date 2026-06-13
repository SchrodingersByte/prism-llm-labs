/**
 * POST /api/training-runs/sync
 *
 * Pulls fine-tuning jobs from OpenAI (and SageMaker via Cost Explorer)
 * and upserts them into the training_runs table.
 * Called manually from the Training dashboard or daily via cron.
 */

import { NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { syncOpenAIFineTuningJobs } from "@/lib/billing/openai-training";
import { decryptKey } from "@/lib/crypto/keys";

export async function POST() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  // Reads provider-key secrets to sync → owner/administrator only.
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const admin = createAdminClient();

  // Fetch all active OpenAI provider keys with reconciliation enabled for this org
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: providerKeys } = await (admin as any)
    .from("provider_keys")
    .select("id, key_encrypted, key_hint")
    .eq("org_id", member.org_id)
    .eq("provider", "openai")
    .eq("is_active", true) as { data: Array<{ id: string; key_encrypted: string; key_hint: string }> | null };

  if (!providerKeys?.length) {
    return NextResponse.json({ ok: true, synced: 0, message: "No active OpenAI provider keys found" });
  }

  let totalSynced = 0;
  const allErrors: string[] = [];

  for (const pk of providerKeys) {
    try {
      const apiKey = decryptKey(pk.key_encrypted);
      const { synced, errors } = await syncOpenAIFineTuningJobs(
        admin,
        member.org_id,
        apiKey,
      );
      totalSynced += synced;
      allErrors.push(...errors.map(e => `key …${pk.key_hint}: ${e}`));
    } catch (err) {
      allErrors.push(`key …${pk.key_hint}: ${String(err)}`);
    }
  }

  return NextResponse.json({
    ok:     true,
    synced: totalSynced,
    errors: allErrors,
  });
}
