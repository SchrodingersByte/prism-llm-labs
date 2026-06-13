import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap",
  {
    variants: {
      variant: {
        default:     "border-transparent bg-primary text-primary-foreground",
        secondary:   "border-transparent bg-secondary text-secondary-foreground",
        outline:     "border-border text-foreground",
        destructive: "border-transparent bg-destructive/15 text-destructive",
        success:     "border-transparent bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        warning:     "border-transparent bg-amber-500/15 text-amber-600 dark:text-amber-400",
        info:        "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400",
        danger:      "border-transparent bg-rose-500/15 text-rose-600 dark:text-rose-400",
        violet:      "border-transparent bg-violet-500/15 text-violet-600 dark:text-violet-400",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
