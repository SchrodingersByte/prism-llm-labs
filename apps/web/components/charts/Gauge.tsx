"use client";

/**
 * Semicircular gauge for a 0–1 rate (cache hit, utilization, speedup) — the
 * Portkey-style radial dial. Track + value arc + needle + centered value label.
 */
export function Gauge({
  value,
  label,
  sublabel,
  height = 150,
}: {
  value: number;
  label?: string;
  sublabel?: string;
  height?: number;
}) {
  const f = Math.max(0, Math.min(1, value));
  const cx = 100, cy = 100, r = 80, ri = r - 14;
  // angle sweeps 180° (left) → 360° (right) over the top; screen coords (y down).
  const a = Math.PI * (1 + f);
  const vx = cx + r * Math.cos(a);
  const vy = cy + r * Math.sin(a);
  const nx = cx + ri * Math.cos(a);
  const ny = cy + ri * Math.sin(a);

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" width="100%" height={height} role="img" aria-label={label ?? "gauge"}>
        <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="hsl(var(--muted))" strokeWidth="14" strokeLinecap="round" />
        <path d={`M20,100 A80,80 0 0 1 ${vx.toFixed(2)},${vy.toFixed(2)}`} fill="none" stroke="hsl(var(--primary))" strokeWidth="14" strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="hsl(var(--foreground))" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={cx} cy={cy} r="5" fill="hsl(var(--foreground))" />
        {label && (
          <text x="100" y="90" textAnchor="middle" className="fill-foreground" style={{ fontSize: 24, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{label}</text>
        )}
      </svg>
      {sublabel && <p className="-mt-1 text-xs text-muted-foreground">{sublabel}</p>}
    </div>
  );
}
