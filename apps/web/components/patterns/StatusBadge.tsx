import { cn } from "@/lib/utils";

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const DOT: Record<StatusTone, string> = {
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger:  "bg-rose-500",
  info:    "bg-blue-500",
  neutral: "bg-muted-foreground",
};

/** Dot + label status indicator, e.g. active / paused / error. */
export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-foreground", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      {children}
    </span>
  );
}
