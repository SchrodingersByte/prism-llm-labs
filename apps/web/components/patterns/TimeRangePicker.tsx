"use client";

import { useScope } from "@/hooks/useScope";
import { RANGE_OPTIONS } from "@/lib/scope";
import { cn } from "@/lib/utils";

/** Compact segmented range control bound to the URL scope. */
export function TimeRangePicker() {
  const { scope, setScope } = useScope();
  return (
    <div className="inline-flex items-center rounded-md border border-border p-0.5">
      {RANGE_OPTIONS.map((r) => (
        <button
          key={r}
          onClick={() => setScope({ range: r })}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium transition-colors",
            scope.range === r ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
