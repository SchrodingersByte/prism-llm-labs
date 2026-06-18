"use client";

import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { VIZ } from "@/lib/charts/theme";

/** Tiny axis-less trend line. Render inside a sized box (e.g. h-8 w-20). */
export function Sparkline({ data, color = VIZ.gold }: { data: number[]; color?: string }) {
  const points = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Line type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
