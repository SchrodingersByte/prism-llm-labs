import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { SPEND_TABS } from "@/lib/nav";

export default function SpendLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Spend" description="Cost trends, attribution, and reconciliation." className="border-b-0 pb-2" />
      <PageTabs tabs={SPEND_TABS} />
      {children}
    </div>
  );
}
