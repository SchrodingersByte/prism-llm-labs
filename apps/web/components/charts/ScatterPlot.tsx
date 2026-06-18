"use client";

import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { VIZ, CHART_GRID, axisProps, tooltipContentStyle, tooltipLabelStyle } from "@/lib/charts/theme";

/** Scatter cloud — e.g. tokens vs requests per day. */
export function ScatterPlot({
  data, xKey, yKey, color = VIZ.violet, height = 200, xFormatter, yFormatter,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  color?: string;
  height?: number;
  xFormatter?: (v: number) => string;
  yFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
        <XAxis type="number" dataKey={xKey} {...axisProps} tickFormatter={xFormatter} />
        <YAxis type="number" dataKey={yKey} {...axisProps} width={44} tickFormatter={yFormatter} />
        <Tooltip contentStyle={tooltipContentStyle} labelStyle={tooltipLabelStyle} cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill={color} fillOpacity={0.7} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
