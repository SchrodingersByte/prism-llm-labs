"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, PanelLeftClose, PanelLeftOpen, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ORG_NAV, PROJECT_NAV, projectHref, parseProjectPath, canSee, type NavRole } from "@/lib/nav";
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

export function Sidebar({ role }: { role: NavRole }) {
  const pathname = usePathname();
  const project = parseProjectPath(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem("sidebar-collapsed");
    if (saved !== null) setCollapsed(saved === "true");
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      return next;
    });
  }

  if (!mounted) return <aside style={{ width: 220 }} className="shrink-0 border-r border-border bg-background" />;
  const width = collapsed ? 56 : 220;

  return (
    <aside
      style={{ width }}
      className="flex h-screen shrink-0 flex-col border-r border-border bg-background transition-[width] duration-200 ease-in-out"
    >
      <div className={cn("flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-3.5", collapsed && "justify-center px-0")}>
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-[13px] font-semibold text-primary-foreground">P</span>
        {!collapsed && <span className="text-sm font-medium tracking-tight">Prism</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2 dash-scroll">
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
          ORG_NAV.filter((item) => canSee(role, item)).map((item) => (
            <NavItem
              key={item.href}
              href={item.href}
              label={item.label}
              icon={item.icon}
              active={item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/")}
              collapsed={collapsed}
            />
          ))
        )}
      </nav>

      <div className="shrink-0 border-t border-border p-2">
        <button
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : (
            <>
              <PanelLeftClose className="h-[18px] w-[18px]" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
