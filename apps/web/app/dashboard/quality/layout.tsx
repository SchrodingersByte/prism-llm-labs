import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { QUALITY_TABS } from "@/lib/nav";

export default function QualityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Quality" description="Output quality scores, annotations, and error clusters." className="border-b-0 pb-2" />
      <PageTabs tabs={QUALITY_TABS} />
      {children}
    </div>
  );
}
