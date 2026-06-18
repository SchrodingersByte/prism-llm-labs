import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { SETTINGS_TABS } from "@/lib/nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Settings" description="Workspace access, integrations, billing, compliance, and privacy." className="border-b-0 pb-2" />
      <PageTabs tabs={SETTINGS_TABS} />
      {children}
    </div>
  );
}
