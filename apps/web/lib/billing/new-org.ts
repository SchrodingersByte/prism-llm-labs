import { createAdminClient } from "@/lib/supabase/server";

/**
 * Intent for an organization that is paid for BEFORE it exists. Carried in the
 * provider's subscription metadata (Stripe) / notes (Razorpay) so the webhook
 * (and synchronous verify) can create the org once payment succeeds.
 */
export interface NewOrgIntent {
  org_name: string;
  user_id:  string;
  plan:     string;            // "pro" | "team"
  type?:    string;            // personal | team | business | education
  region?:  string;            // "US" | "IN"
}

/** Read a NewOrgIntent out of a metadata/notes bag, or null if not a new-org checkout. */
export function readNewOrgIntent(bag: Record<string, unknown> | null | undefined): NewOrgIntent | null {
  if (!bag || bag.new_org !== "1") return null;
  const org_name = typeof bag.org_name === "string" ? bag.org_name : "";
  const user_id  = typeof bag.user_id === "string" ? bag.user_id : "";
  const plan     = typeof bag.plan === "string" ? bag.plan : "";
  if (!org_name || !user_id || !plan) return null;
  return {
    org_name,
    user_id,
    plan,
    type:   typeof bag.org_type === "string" ? bag.org_type : undefined,
    region: typeof bag.region === "string" ? bag.region : undefined,
  };
}

/** Metadata/notes bag for a new-org checkout — symmetrical with readNewOrgIntent. */
export function newOrgMetadata(intent: NewOrgIntent): Record<string, string> {
  return {
    new_org:  "1",
    org_name: intent.org_name,
    user_id:  intent.user_id,
    plan:     intent.plan,
    org_type: intent.type ?? "personal",
    region:   intent.region ?? "US",
  };
}

/**
 * Idempotently create an org after a successful paid checkout. Keyed on the
 * provider subscription id, so webhook retries — or the verify callback firing
 * alongside the webhook — never create duplicates. Creates org + owner
 * membership + a Default project, and switches the user into it.
 */
export async function finalizeNewOrg(args: {
  provider:       "stripe" | "razorpay";
  subscriptionId: string;
  customerId?:    string | null;
  intent:         NewOrgIntent;
}): Promise<{ orgId: string; created: boolean }> {
  const admin = createAdminClient();
  const subCol  = args.provider === "stripe" ? "stripe_subscription_id" : "razorpay_subscription_id";
  const custCol = args.provider === "stripe" ? "stripe_customer_id"     : "razorpay_customer_id";

  // Idempotency: has this subscription already produced an org?
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (admin as any)
    .from("organizations").select("id").eq(subCol, args.subscriptionId).maybeSingle();
  if (existing?.id) return { orgId: existing.id as string, created: false };

  const base = args.intent.org_name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const slug = `${base || "org"}-${Math.random().toString(36).slice(2, 8)}`;

  const orgInsert: Record<string, unknown> = {
    name:                args.intent.org_name,
    slug,
    plan:                args.intent.plan,
    subscription_status: "active",
    type:                args.intent.type ?? "personal",
    billing_region:      args.intent.region ?? "US",
    [subCol]:            args.subscriptionId,
  };
  if (args.customerId) orgInsert[custCol] = args.customerId;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: org, error } = await (admin as any)
    .from("organizations").insert(orgInsert).select("id").single();
  if (error || !org) throw new Error(`finalizeNewOrg: failed to create org: ${error?.message ?? "unknown"}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("members")
    .insert({ org_id: org.id, user_id: args.intent.user_id, scope_type: "organization", role: "owner" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("projects")
    .insert({ org_id: org.id, name: "Default", slug: "default" });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from("user_preferences")
    .upsert({ user_id: args.intent.user_id, active_org_id: org.id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });

  return { orgId: org.id as string, created: true };
}
