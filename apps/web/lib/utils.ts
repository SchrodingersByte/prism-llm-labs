import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a USD cost with enough decimal places to be non-zero for micro-costs. */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return `$${usd.toFixed(8)}`;
  if (usd < 0.01)   return `$${usd.toFixed(6)}`;
  if (usd < 1)      return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
