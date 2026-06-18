"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { TabItem } from "@/lib/nav";

/**
 * Top-of-page tab bar for 3rd-level sub-routes (the nav rule: sidebar holds
 * 2 levels, the 3rd becomes tabs). Each tab is a real route (Link); active is
 * derived from the pathname. Render inside a section's layout, under PageHeader.
 */
export function PageTabs({ tabs, className }: { tabs: TabItem[]; className?: string }) {
  const pathname = usePathname();
  if (!tabs.length) return null;

  return (
    <nav className={cn("flex items-center gap-1 overflow-x-auto border-b border-border px-5 dash-scroll", className)}>
      {tabs.map((t) => {
        const active = t.exact
          ? pathname === t.href
          : pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative -mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors",
              active
                ? "border-primary font-medium text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
