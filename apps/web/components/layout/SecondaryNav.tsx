"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PROJECT_NAV, projectHref, parseProjectPath } from "@/lib/nav";
import { cn } from "@/lib/utils";

/**
 * Supabase-style secondary panel: lists the sub-pages of the active project
 * section. Renders nothing for sections without sub-pages (or outside a project).
 */
export function SecondaryNav() {
  const pathname = usePathname();
  const ctx = parseProjectPath(pathname);
  if (!ctx) return null;

  const section = PROJECT_NAV.find((s) => s.seg === ctx.section);
  if (!section?.sub) return null;

  return (
    <nav className="w-48 shrink-0 border-r border-border p-2">
      <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {section.label}
      </p>
      <div className="flex flex-col gap-0.5">
        {section.sub.map((s) => {
          const href = projectHref(ctx.id, section.seg, s.seg || undefined);
          const active = ctx.sub === s.seg;
          return (
            <Link
              key={s.seg || "index"}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-2 py-1.5 text-sm transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
