"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft, ChevronLeft, ChevronRight, ChevronDown, Plus,
  Settings as SettingsIcon, type LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import {
  ORG_GROUPS, PROJECT_NAV, projectHref, parseProjectPath, canSee,
  type NavRole, type NavGroup,
} from "@/lib/nav";
import { cn } from "@/lib/utils";

function NavItem({
  href, label, icon: Icon, active, collapsed,
}: { href: string; label: string; icon: LucideIcon; active: boolean; collapsed: boolean }) {
  const el = (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r-full bg-primary" />}
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{el}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return el;
}

function OrgGroup({
  group, role, pathname, collapsed, closed, onToggle,
}: {
  group: NavGroup; role: NavRole; pathname: string; collapsed: boolean;
  closed: boolean; onToggle: () => void;
}) {
  const items = group.items.filter((i) => canSee(role, i));
  if (!items.length) return null;

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  if (collapsed) {
    return (
      <div className="flex flex-col gap-0.5 border-t border-border/60 pt-1 first:border-0 first:pt-0">
        {items.map((i) => (
          <NavItem key={i.href} href={i.href} label={i.label} icon={i.icon} active={isActive(i.href, i.exact)} collapsed />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <button
        onClick={onToggle}
        className="flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-muted-foreground"
      >
        <span>{group.label}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", closed && "-rotate-90")} />
      </button>
      {!closed && (
        <div className="flex flex-col gap-0.5">
          {items.map((i) => (
            <NavItem key={i.href} href={i.href} label={i.label} icon={i.icon} active={isActive(i.href, i.exact)} collapsed={false} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sidebar({ role, userEmail, userName }: { role: NavRole; userEmail: string; userName?: string }) {
  const pathname = usePathname();
  const project = parseProjectPath(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "true");
    try { setClosed(JSON.parse(localStorage.getItem("sidebar-groups") ?? "{}")); } catch { /* ignore */ }
  }, []);

  function toggleCollapse() {
    setCollapsed((p) => { const n = !p; localStorage.setItem("sidebar-collapsed", String(n)); return n; });
  }
  function toggleGroup(label: string) {
    setClosed((p) => { const n = { ...p, [label]: !p[label] }; localStorage.setItem("sidebar-groups", JSON.stringify(n)); return n; });
  }

  const canManage = role === "owner" || role === "administrator";
  const name = userName?.trim() || userEmail.split("@")[0] || "Account";
  const initials = (userName?.trim()?.slice(0, 2) || userEmail.slice(0, 2) || "··").toUpperCase();

  if (!mounted) return <aside style={{ width: 248 }} className="m-2 shrink-0 rounded-2xl border border-border bg-card" />;
  const width = collapsed ? 64 : 248;

  return (
    <aside
      style={{ width }}
      className="m-2 flex shrink-0 flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[width] duration-200 ease-in-out"
    >
      {/* Profile header */}
      <div className={cn("flex items-center gap-2.5 border-b border-border p-3", collapsed && "justify-center p-2")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-[13px] font-semibold text-primary-foreground">
          {initials}
        </span>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-muted-foreground">Hello 👋</p>
            <p className="truncate text-sm font-semibold">{name}</p>
          </div>
        )}
        {!collapsed && (
          <button onClick={toggleCollapse} aria-label="Collapse sidebar"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-2 dash-scroll">
        {project ? (
          <>
            <NavItem href="/dashboard/projects" label="All projects" icon={ArrowLeft} active={false} collapsed={collapsed} />
            <div className="my-1 h-px bg-border" />
            {PROJECT_NAV.filter((s) => canSee(role, s)).map((s) => (
              <NavItem
                key={s.seg || "overview"}
                href={projectHref(project.id, s.seg)}
                label={s.label}
                icon={s.icon}
                active={project.section === s.seg}
                collapsed={collapsed}
              />
            ))}
          </>
        ) : (
          ORG_GROUPS.map((g) => (
            <OrgGroup
              key={g.label}
              group={g}
              role={role}
              pathname={pathname}
              collapsed={collapsed}
              closed={!!closed[g.label]}
              onToggle={() => toggleGroup(g.label)}
            />
          ))
        )}
      </nav>

      {/* Footer: New project CTA + Settings + (collapsed) expand toggle */}
      <div className="shrink-0 border-t border-border p-2">
        {!project && canManage && (
          collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/dashboard/projects" aria-label="New project"
                  className="flex items-center justify-center rounded-md py-2 text-primary transition-colors hover:bg-muted">
                  <Plus className="h-[18px] w-[18px]" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">New project</TooltipContent>
            </Tooltip>
          ) : (
            <Link href="/dashboard/projects"
              className="mb-1 flex flex-col items-center gap-1.5 rounded-xl border border-dashed border-primary/30 px-3 py-3 text-center transition-colors hover:border-primary/60 hover:bg-primary/5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Plus className="h-4 w-4" />
              </span>
              <span className="text-xs font-medium">New project</span>
            </Link>
          )
        )}

        {canManage && (
          <NavItem
            href="/dashboard/settings"
            label="Settings"
            icon={SettingsIcon}
            active={pathname.startsWith("/dashboard/settings") || pathname.startsWith("/dashboard/account")}
            collapsed={collapsed}
          />
        )}

        {collapsed && (
          <button onClick={toggleCollapse} aria-label="Expand sidebar"
            className="mt-0.5 flex w-full items-center justify-center rounded-md py-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>
    </aside>
  );
}
