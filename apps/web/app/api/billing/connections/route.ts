import { NextRequest, NextResponse } from "next/server";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { checkFeature } from "@/lib/billing/feature-guard";
import { encryptKey } from "@/lib/crypto/keys";
import { z } from "zod";

const PROVIDERS = ["aws", "pinecone", "qdrant", "weaviate", "azure"] as const;

const CreateSchema = z.object({
  provider:         z.enum(PROVIDERS),
  display_name:     z.string().min(1).max(100),
  credentials:      z.record(z.string()), // plain JSON — encrypted server-side
  config:           z.record(z.unknown()).default({}),
  attribution_mode: z.enum(["proportional", "tag_based"]).default("proportional"),
});

export async function GET() {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from("cloud_billing_connections")
    .select("id, provider, display_name, config, attribution_mode, last_synced_at, last_sync_status, last_sync_cost_usd, is_active, created_at")
    .eq("org_id", member.org_id)
    .order("created_at");

  // Never return credentials_encrypted to the client
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No org" }, { status: 403 });
  // Cloud billing connections hold provider credentials → owner/administrator only.
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  const guard = await checkFeature(member.org_id, "billing_connections");
  if (guard) return guard;

  const body = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message ?? "Invalid" }, { status: 400 });
  }

  // Encrypt the credentials JSON blob with AES-256-CBC
  const credentialsJson     = JSON.stringify(body.data.credentials);
  const credentials_encrypted = encryptKey(credentialsJson);

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: dbErr } = await (admin as any)
    .from("cloud_billing_connections")
    .insert({
      org_id:                   member.org_id,
      provider:                 body.data.provider,
      display_name:             body.data.display_name,
      credentials_encrypted,
      config:                   body.data.config,
      attribution_mode:         body.data.attribution_mode,
    })
    .select("id, provider, display_name, config, attribution_mode, created_at")
    .single();

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
