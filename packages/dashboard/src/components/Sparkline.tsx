interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  label?: string;
  unit?: string;
}

export function Sparkline({
  data,
  width = 200,
  height = 40,
  color = "var(--accent)",
  label,
  unit = "",
}: SparklineProps) {
  if (!data.length) {
    return (
      <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>no data</span>
      </div>
    );
  }

  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;
  const max = Math.max(...data, 0.1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1 || 1)) * w;
    const y = padding + h - ((v - min) / range) * h;
    return `${x},${y}`;
  });

  const path = `M ${points.join(" L ")}`;
  const areaPath = `${path} L ${padding + w},${padding + h} L ${padding},${padding + h} Z`;

  const current = data[data.length - 1];

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: "var(--muted)" }}>{label}</span>
          <span className="mono" style={{ color: "var(--text)" }}>
            {current.toFixed(1)}{unit}
          </span>
        </div>
      )}
      <svg width={width} height={height} style={{ display: "block" }}>
        <path d={areaPath} fill={color} opacity={0.1} />
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
