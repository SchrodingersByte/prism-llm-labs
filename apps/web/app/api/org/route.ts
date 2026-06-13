import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit/log";
import { checkFeature } from "@/lib/billing/feature-guard";
import { DEFAULT_PATTERNS } from "@/lib/privacy/pii-patterns";

/** GET /api/org — fetch workspace name + governance settings */
export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org membership" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org } = await (admin as any)
    .from("organizations")
    .select("name, slug, data_residency_policy, gateway_mode")
    .eq("id", member.org_id)
    .single() as { data: { name: string; slug: string; data_residency_policy: string; gateway_mode: string } | null };

  if (!org) return NextResponse.json({ error: "Org not found" }, { status: 404 });
  return NextResponse.json(org);
}

// Any built-in detector type may be enabled for masking (incl. credential,
// medical, and India / DPDP types) — not just the original five.
const VALID_PII_PATTERNS = DEFAULT_PATTERNS as [string, ...string[]];

const PatchSchema = z.object({
  name:                    z.string().min(1).max(100).trim().optional(),
  data_residency_policy:   z.enum(["any", "eu_only", "us_only", "india_only"]).optional(),
  gateway_mode:            z.enum(["sdk_optional", "gateway_required"]).optional(),
  pii_masking_enabled:     z.boolean().optional(),
  pii_mask_patterns:       z.array(z.enum(VALID_PII_PATTERNS)).optional(),
  pii_detection_enabled:   z.boolean().optional(),
  pii_detection_action:    z.enum(["warn", "block"]).optional(),
  pii_custom_patterns:     z.array(z.object({
    name:    z.string().min(1),
    pattern: z.string().min(1),
    enabled: z.boolean(),
  })).optional(),
  cache_enabled:           z.boolean().optional(),
  cache_ttl_seconds:       z.number().int().min(60).max(86400).optional(),
  cache_mode:              z.enum(["exact", "semantic"]).optional(),
  similarity_threshold:    z.number().min(0.7).max(1.0).optional(),
  cache_conversation_history_threshold: z.number().int().min(0).max(100).optional(),
}).refine(d => Object.values(d).some(v => v !== undefined), {
  message: "At least one field is required",
});

/** PATCH /api/org — update workspace name (owner / admin only) */
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org membership" }, { status: 403 });

  const admin = createAdminClient();

  // Only owners and admins may rename the workspace
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: memberRow } = await (admin as any)
    .from("members")
    .select("role")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle() as { data: { role: string } | null };

  const canEdit = ["owner", "administrator"].includes(memberRow?.role ?? "");
  if (!canEdit) {
    return NextResponse.json({ error: "Only owners and admins can rename the workspace" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name                !== undefined) updates.name                  = parsed.data.name;
  if (parsed.data.data_residency_policy !== undefined) updates.data_residency_policy = parsed.data.data_residency_policy;
  if (parsed.data.gateway_mode          !== undefined) updates.gateway_mode          = parsed.data.gateway_mode;
  if (parsed.data.pii_masking_enabled   !== undefined) updates.pii_masking_enabled   = parsed.data.pii_masking_enabled;
  if (parsed.data.pii_mask_patterns     !== undefined) updates.pii_mask_patterns     = parsed.data.pii_mask_patterns;
  if (parsed.data.pii_detection_enabled !== undefined) updates.pii_detection_enabled = parsed.data.pii_detection_enabled;
  if (parsed.data.pii_detection_action  !== undefined) {
    // Block mode requires pii_block_mode feature access
    if (parsed.data.pii_detection_action === "block") {
      const blockGuard = await checkFeature(member.org_id, "pii_block_mode");
      if (blockGuard) return blockGuard;
    }
    updates.pii_detection_action = parsed.data.pii_detection_action;
  }
  if (parsed.data.pii_custom_patterns   !== undefined) {
    const customGuard = await checkFeature(member.org_id, "pii_custom_patterns");
    if (customGuard) return customGuard;
    // Validate each regex before saving
    for (const p of parsed.data.pii_custom_patterns) {
      if (!p.pattern) continue;
      try { new RegExp(p.pattern); } catch {
        return NextResponse.json({ error: `Invalid regex pattern: ${p.pattern}` }, { status: 400 });
      }
    }
    updates.pii_custom_patterns = parsed.data.pii_custom_patterns;
  }
  if (parsed.data.cache_enabled         !== undefined) updates.cache_enabled         = parsed.data.cache_enabled;
  if (parsed.data.cache_ttl_seconds     !== undefined) updates.cache_ttl_seconds     = parsed.data.cache_ttl_seconds;
  if (parsed.data.cache_mode            !== undefined) updates.cache_mode            = parsed.data.cache_mode;
  if (parsed.data.similarity_threshold  !== undefined) updates.similarity_threshold  = parsed.data.similarity_threshold;
  if (parsed.data.cache_conversation_history_threshold !== undefined) updates.cache_conversation_history_threshold = parsed.data.cache_conversation_history_threshold;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (admin as any)
    .from("organizations")
    .update(updates)
    .eq("id", member.org_id);

  if (updateErr) return NextResponse.json({ error: "Failed to update workspace" }, { status: 500 });

  await writeAuditLog({
    orgId: member.org_id, actorUserId: user.id,
    action: "org.updated", targetType: "organization", targetId: member.org_id,
    metadata: updates,
  });

  return NextResponse.json({ success: true, ...updates });
}
