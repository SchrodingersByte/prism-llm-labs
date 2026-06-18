import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { WORKBENCH_TABS } from "@/lib/nav";

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Workbench" description="Datasets, experiments, comparisons, and the prompt playground." className="border-b-0 pb-2" />
      <PageTabs tabs={WORKBENCH_TABS} />
      {children}
    </div>
  );
}
