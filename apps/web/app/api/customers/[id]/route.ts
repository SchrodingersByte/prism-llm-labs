/**
 * /api/customers/[id] — duplicate of the list/create route in the dev app
 * (no PATCH/DELETE handler exists). Gated identically to /api/customers so the
 * POST here is not an ungated backdoor: create = owner/administrator.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServerClient, getMemberOrg } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isOrgManager } from "@/lib/supabase/metrics-scope";
import { z } from "zod";

const CreateSchema = z.object({
  customer_id:          z.string().min(1).max(255),
  display_name:         z.string().max(255).optional(),
  monthly_spend_usd:    z.number().positive().nullable().optional(),
  monthly_token_limit:  z.number().int().positive().nullable().optional(),
  soft_cap_pct:         z.number().int().min(1).max(100).default(80),
  soft_cap_model:       z.string().max(100).nullable().optional(),
  is_active:            z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("customer_quota_profiles" as any)
    .select("id, customer_id, display_name, monthly_spend_usd, monthly_token_limit, soft_cap_pct, soft_cap_model, is_active, created_at, updated_at")
    .eq("org_id", member.org_id)
    .order("created_at", { ascending: false }) as { data: unknown[] | null; error: unknown };

  if (error) return NextResponse.json({ error: "Failed to load customers" }, { status: 500 });

  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const member = await getMemberOrg(user.id);
  if (!member) return NextResponse.json({ error: "No organization" }, { status: 403 });
  if (!(await isOrgManager(user.id, member.org_id))) {
    return NextResponse.json({ error: "Forbidden — owner or administrator required" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("customer_quota_profiles" as any)
    .insert({
      org_id:              member.org_id,
      customer_id:         parsed.data.customer_id,
      display_name:        parsed.data.display_name   ?? null,
      monthly_spend_usd:   parsed.data.monthly_spend_usd  ?? null,
      monthly_token_limit: parsed.data.monthly_token_limit ?? null,
      soft_cap_pct:        parsed.data.soft_cap_pct,
      soft_cap_model:      parsed.data.soft_cap_model  ?? null,
      is_active:           parsed.data.is_active,
    })
    .select()
    .single() as { data: unknown; error: unknown };

  if (error) {
    const msg = (error as { message?: string }).message ?? "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: `Customer ID "${parsed.data.customer_id}" already exists in your org.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Failed to create customer" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
