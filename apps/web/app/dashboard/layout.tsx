import { redirect } from "next/navigation";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { RoleProvider } from "@/components/layout/role-context";
import { type NavRole } from "@/lib/nav";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const member = await getMemberOrg(user.id);
  if (!member) redirect("/onboarding");

  const admin = createAdminClient();

  // All orgs this user belongs to (for the workspace switcher).
  const { data: memberRows } = await admin.from("members").select("org_id").eq("user_id", user.id);
  const orgIds: string[] = (memberRows ?? []).map((r: { org_id: string }) => r.org_id);

  const { data: orgRows } = await admin
    .from("organizations")
    .select("id, name, onboarding_step")
    .in("id", orgIds.length ? orgIds : [member.org_id]);

  const orgs = (orgRows ?? []).map((o: { id: string; name: string }) => ({ id: o.id, name: o.name }));

  // Gate users who haven't finished onboarding for the active org.
  const currentOrg = (orgRows ?? []).find((o: { id: string }) => o.id === member.org_id) as
    | { onboarding_step?: number }
    | undefined;
  if (currentOrg?.onboarding_step === 0) redirect("/onboarding");

  // Resolve the caller's role in the active org to drive role-aware nav.
  const { data: roleRow } = await admin
    .from("members")
    .select("role")
    .eq("org_id", member.org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  const rawRole = (roleRow as { role?: string | null } | null)?.role;
  // Map the DB role (owner|administrator|developer|read_only, or null for a
  // project-scoped member) to a NavRole for role-aware nav. Legacy "admin"
  // normalizes to "administrator"; project-scoped/unknown fall back to developer.
  const role: NavRole =
    rawRole === "owner"                                  ? "owner"
    : rawRole === "administrator" || rawRole === "admin" ? "administrator"
    : rawRole === "read_only"                            ? "read_only"
    : "developer";

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar orgs={orgs} activeOrgId={member.org_id} userEmail={user.email ?? ""} role={role} />
        <main className="flex-1 overflow-y-auto dash-scroll">
          <RoleProvider role={role}>{children}</RoleProvider>
        </main>
      </div>
    </div>
  );
}
