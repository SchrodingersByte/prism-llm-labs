import { createServerClient, getMemberOrg, createAdminClient } from "@/lib/supabase/server";
import { resetCircuitBreaker } from "@/lib/upstash/circuit-breaker";
import { NextResponse } from "next/server";

export async function DELETE(
  _req: Request,
  { params }: { params: { keyId: string } },
) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Verify the key belongs to this org before resetting
  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: key } = await (admin as any)
    .from("api_keys")
    .select("id")
    .eq("id", params.keyId)
    .eq("org_id", member.org_id)
    .maybeSingle() as { data: { id: string } | null };

  if (!key) return NextResponse.json({ error: "Key not found" }, { status: 404 });

  await resetCircuitBreaker(member.org_id, params.keyId);
  return NextResponse.json({ ok: true });
}
