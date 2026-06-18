import type { CSSProperties } from "react";

/**
 * Recharts theming constants. Recharts can't read CSS variables at render time,
 * so the data-viz palette is mirrored here as concrete hex values (kept in sync
 * with the --viz-* tokens in globals.css). Low-alpha grid/axis colors are chosen
 * to read correctly in both light and dark themes.
 */

export const VIZ = {
  /* Brand palette — gold-led, coral as the signal. Mid-tones chosen to read on
     BOTH white and near-black (Recharts renders one value for both themes); the
     CSS --viz-* tokens carry brighter per-mode values for surfaces we control. */
  gold:    "#eab308",
  sky:     "#0ea5e9",
  violet:  "#8b5cf6",
  emerald: "#10b981",
  coral:   "#f2605c",
  blue:    "#3b82f6",
  slate:   "#64748b",
  amber:   "#eab308",
  /* Back-compat aliases (old slot names → new palette) */
  indigo:  "#eab308",
  cyan:    "#0ea5e9",
  rose:    "#f2605c",
} as const;

export type VizColor = keyof typeof VIZ;

/** Default categorical series order (used when a chart has N series). */
export const VIZ_SERIES: string[] = [
  VIZ.gold, VIZ.sky, VIZ.violet, VIZ.emerald, VIZ.coral, VIZ.blue, VIZ.slate,
];

/** Pick a stable color for the i-th series, wrapping if needed. */
export function seriesColor(i: number): string {
  return VIZ_SERIES[i % VIZ_SERIES.length]!;
}

/** Semantic deltas (e.g. error rate down = good). */
export const SEMANTIC = {
  positive: VIZ.emerald,
  negative: VIZ.coral,
  neutral:  VIZ.slate,
} as const;

export const CHART_GRID = "rgba(148, 163, 184, 0.14)";
export const AXIS_TICK_FILL = "rgba(148, 163, 184, 0.85)";

/** Shared Recharts axis props for a clean, dense look. */
export const axisProps = {
  tick: { fill: AXIS_TICK_FILL, fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

/** Inline style for a Recharts <Tooltip /> content box matching the card surface. */
export const tooltipContentStyle: CSSProperties = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
  padding: "8px 10px",
  color: "hsl(var(--popover-foreground))",
  boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
};

export const tooltipLabelStyle: CSSProperties = {
  color: "hsl(var(--muted-foreground))",
  marginBottom: 4,
  fontSize: 11,
};
