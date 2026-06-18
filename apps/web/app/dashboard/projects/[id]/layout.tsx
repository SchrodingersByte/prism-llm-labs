import { notFound, redirect } from "next/navigation";
import { createServerClient, createAdminClient, getMemberOrg } from "@/lib/supabase/server";
import { ProjectProvider } from "@/components/layout/project-context";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const member = await getMemberOrg(user.id);
  if (!member) redirect("/onboarding");

  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("id, name, slug, cost_center_code, org_id")
    .eq("id", params.id)
    .maybeSingle();

  // 404 if the project doesn't exist or belongs to another org (tenant isolation).
  if (!project || (project as { org_id?: string }).org_id !== member.org_id) notFound();

  // Project isolation: org-scoped members (any role) may open every project;
  // project-scoped members may only open projects granted via member_project_roles.
  const { data: roleRow } = await admin
    .from("members").select("id, scope_type").eq("org_id", member.org_id).eq("user_id", user.id).maybeSingle();
  const m = roleRow as { id?: string; scope_type?: string } | null;
  if (!m) notFound();
  if (m.scope_type === "project") {
    const { data: assigned } = await admin
      .from("member_project_roles").select("project_id").eq("member_id", m.id).eq("project_id", params.id).maybeSingle();
    if (!assigned) notFound();
  }

  const info = {
    id:               (project as { id: string }).id,
    name:             (project as { name: string }).name,
    slug:             (project as { slug?: string | null }).slug ?? null,
    cost_center_code: (project as { cost_center_code?: string | null }).cost_center_code ?? null,
  };

  return (
    <ProjectProvider project={info}>
      <div className="min-w-0 flex-1">{children}</div>
    </ProjectProvider>
  );
}
