import { OrgSwitcher, type OrgOption } from "./OrgSwitcher";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { ScopeBar } from "./ScopeBar";
import { EnvSwitcher } from "./EnvSwitcher";
import { CommandPalette } from "./CommandPalette";
import { NotificationsBell } from "./NotificationsBell";
import { ThemeToggle } from "./ThemeToggle";
import { AccountMenu } from "./AccountMenu";
import { Separator } from "@/components/ui/separator";
import { type NavRole } from "@/lib/nav";

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
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <OrgSwitcher orgs={orgs} activeOrgId={activeOrgId} />
      <ProjectSwitcher />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ScopeBar />
      <EnvSwitcher />
      <div className="ml-auto flex items-center gap-1.5">
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
