import { PageHeader } from "@/components/patterns/PageHeader";
import { PageTabs } from "@/components/layout/PageTabs";
import { ACCOUNT_TABS } from "@/lib/nav";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader title="Account" description="Organization settings, members, and SSO." className="border-b-0 pb-2" />
      <PageTabs tabs={ACCOUNT_TABS} />
      {children}
    </div>
  );
}
