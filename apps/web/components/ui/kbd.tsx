import * as React from "react";
import { cn } from "@/lib/utils";

/** Small keyboard-shortcut hint, e.g. <Kbd>⌘</Kbd><Kbd>K</Kbd>. */
function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
