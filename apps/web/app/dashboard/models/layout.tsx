import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { MODELS_TABS } from "@/lib/nav";

export default function ModelsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Models" description="Per-model cost, efficiency, latency, and reliability." className="border-b-0 pb-2" />
      <PageTabs tabs={MODELS_TABS} />
      {children}
    </div>
  );
}
