import { redirect } from "next/navigation";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { PolicyCard, type PolicyRow } from "./_components/PolicyCard";

export const revalidate = 30;

export default async function PolicyPage() {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const member = await getMemberOrg(user.id);
  if (!member) redirect("/onboarding");

  const admin = createAdminClient();

  // Fetch current org policy + member role in parallel
  const [policyRes, memberRes] = await Promise.all([
    (admin as any)
      .from("enforcement_policies")
      .select("*")
      .eq("scope_type", "org")
      .eq("scope_id", member.org_id)
      .maybeSingle() as Promise<{ data: PolicyRow | null }>,
    (admin as any)
      .from("members")
      .select("role")
      .eq("org_id", member.org_id)
      .eq("user_id", user.id)
      .maybeSingle() as Promise<{ data: { role: string } | null }>,
  ]);

  const policy  = policyRes.data;
  const isOwner = memberRes.data?.role === "owner";

  return (
    <div className="min-h-screen bg-[#0d1117]">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">

        {/* ── Page header ── */}
        <div>
          <h1 className="text-[22px] font-semibold text-white tracking-tight">
            Enforcement Policies
          </h1>
          <p className="mt-1 text-[13px] text-[#5a6b8c]">
            Control model access, rate limits, and privacy rules for your workspace.
            {!isOwner && (
              <span className="ml-1 text-amber-500/80">
                Only workspace owners can make changes.
              </span>
            )}
          </p>
        </div>

        {/* ── Workspace policy ── */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-[13px] font-semibold text-white">Workspace Policy</h2>
            <span className="rounded-md bg-[#0b0f1a] border border-[#1a2035] px-2 py-0.5 text-[10px] text-[#5a6b8c] font-medium uppercase tracking-wider">
              Org-level
            </span>
          </div>
          <PolicyCard initialPolicy={policy} isOwner={isOwner} />
        </div>

        {/* ── Project policies (placeholder) ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold text-white">Project Policies</h2>
              <span className="rounded-md bg-[#0b0f1a] border border-[#1a2035] px-2 py-0.5 text-[10px] text-[#5a6b8c] font-medium uppercase tracking-wider">
                Per-project
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-[#0b0f1a] border border-[#1a2035] border-dashed px-6 py-8 text-center">
            <p className="text-[13px] text-[#5a6b8c]">Project-level policy overrides coming soon.</p>
            <p className="mt-1 text-[12px] text-[#3d4f6e]">
              Override workspace defaults per project — useful for different environments or teams.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
