import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { projectTabs } from "@/lib/nav";

export default function ProjectObservabilityLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <div>
      <PageHeader title="Observability" description="Logs, sessions, traces, and agents for this project." className="border-b-0 pb-2" />
      <PageTabs tabs={projectTabs(params.id, "observability")} />
      {children}
    </div>
  );
}
