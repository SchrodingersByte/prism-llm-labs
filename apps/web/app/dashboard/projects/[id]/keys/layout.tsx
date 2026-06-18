import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { projectTabs } from "@/lib/nav";

export default function ProjectKeysLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  return (
    <div>
      <PageHeader title="API Keys" description="Keys, spend caps, and extension requests for this project." className="border-b-0 pb-2" />
      <PageTabs tabs={projectTabs(params.id, "keys")} />
      {children}
    </div>
  );
}
