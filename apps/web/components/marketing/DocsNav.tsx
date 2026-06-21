"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DocSection { id: string; label: string }

export function DocsNav({ sections }: { sections: DocSection[] }) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className="space-y-0.5">
      <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-[var(--mk-faint)]">
        On this page
      </p>
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={cn(
            "block rounded-md border-l-2 px-3 py-1.5 text-sm transition-colors",
            active === s.id
              ? "border-[var(--mk-violet)] bg-white/[0.03] text-[var(--mk-fg)]"
              : "border-transparent text-[var(--mk-muted)] hover:text-[var(--mk-fg)]"
          )}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
