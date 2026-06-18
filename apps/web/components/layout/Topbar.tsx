import { OrgSwitcher, type OrgOption } from "./OrgSwitcher";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ScopeBar } from "./ScopeBar";
import { EnvSwitcher } from "./EnvSwitcher";
import { CommandPalette } from "./CommandPalette";
import { NotificationsBell } from "./NotificationsBell";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { FeedbackButton } from "./FeedbackButton";
import { QuickSetupButton } from "@/components/dashboard/QuickSetupButton";
import { Separator } from "@/components/ui/separator";
import { type NavRole } from "@/lib/nav";

/**
 * Supabase-style topbar: breadcrumb switchers + scope filters on the left;
 * Feedback · Search (⌘K) · Setup guide · Notifications · Theme · Account on the right.
 */
export function Topbar({
  orgs,
  activeOrgId,
  userEmail,
  role,
}: {
  orgs: OrgOption[];
  activeOrgId: string;
  userEmail: string;
  role: NavRole;
}) {
  const canManage = role === "owner" || role === "administrator";
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      <ProjectSwitcher canManage={canManage} />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ScopeBar canManage={canManage} />
      <EnvSwitcher />

      <div className="ml-auto flex items-center gap-1.5">
        <QuickSetupButton />
        <FeedbackButton />
        <div className="hidden lg:block">
          <CommandPalette role={role} />
        </div>
        <NotificationsBell />
        <ThemeToggle />
        <AccountMenu userEmail={userEmail} />
      </div>
    </header>
  );
}
