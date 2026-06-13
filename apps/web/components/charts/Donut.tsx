"use client";

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { seriesColor, tooltipContentStyle } from "@/lib/charts/theme";

export interface DonutDatum {
  name: string;
  value: number;
}

export function Donut({
  data,
  height = 180,
  colors,
  valueFormatter,
}: {
  data: DonutDatum[];
  height?: number;
  colors?: string[];
  valueFormatter?: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="58%"
          outerRadius="85%"
          paddingAngle={2}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors?.[i] ?? seriesColor(i)} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipContentStyle} formatter={valueFormatter ? (v) => valueFormatter(Number(v)) : undefined} />
      </PieChart>
    </ResponsiveContainer>
  );
}
