interface ServiceNode {
  type: string;
  tier: string;
  provider: string | null;
  containerStatus: string;
}

interface ServiceCanvasProps {
  projectName: string;
  framework: string;
  services: ServiceNode[];
  deployStatus?: string;
}

const BLOCK_W = 140;
const BLOCK_H = 56;
const GAP_Y = 60;
const GAP_X = 24;

export function ServiceCanvas({ projectName, framework, services, deployStatus }: ServiceCanvasProps) {
  const totalServices = services.length;
  const totalWidth = totalServices > 0
    ? Math.max(BLOCK_W + 40, totalServices * (BLOCK_W + GAP_X) - GAP_X + 40)
    : BLOCK_W + 40;
  const height = totalServices > 0 ? BLOCK_H * 2 + GAP_Y + 40 : BLOCK_H + 40;

  const appX = totalWidth / 2 - BLOCK_W / 2;
  const appY = 16;

  const serviceStartX = totalServices > 0
    ? (totalWidth - (totalServices * (BLOCK_W + GAP_X) - GAP_X)) / 2
    : 0;
  const serviceY = appY + BLOCK_H + GAP_Y;

  const appStatus = deployStatus === "live" ? "#0cce6b" : deployStatus === "failed" ? "#ee5253" : "#f5a623";

  return (
    <svg width={totalWidth} height={height} style={{ display: "block", margin: "16px auto 0" }}>
      {/* App block */}
      <Block x={appX} y={appY} label={projectName} sub={framework} color={appStatus} />

      {/* Service blocks + connections */}
      {services.map((svc, i) => {
        const sx = serviceStartX + i * (BLOCK_W + GAP_X);
        const sy = serviceY;
        const statusColor = svc.containerStatus === "running" ? "#0cce6b" : "#f5a623";
        const label = svc.type === "postgres" ? "PostgreSQL" : svc.type === "redis" ? "Redis" : svc.type;
        const sub = svc.tier + (svc.provider ? ` (${svc.provider})` : "");

        return (
          <g key={i}>
            {/* Connection line */}
            <line
              x1={appX + BLOCK_W / 2} y1={appY + BLOCK_H}
              x2={sx + BLOCK_W / 2} y2={sy}
              stroke="var(--border)" strokeWidth={1.5} strokeDasharray="4 3"
            />
            <Block x={sx} y={sy} label={label} sub={sub} color={statusColor} />
          </g>
        );
      })}
    </svg>
  );
}

function Block({ x, y, label, sub, color }: { x: number; y: number; label: string; sub: string; color: string }) {
  return (
    <g>
      <rect
        x={x} y={y} width={BLOCK_W} height={BLOCK_H} rx={8}
        fill="var(--surface)" stroke="var(--border)" strokeWidth={1}
      />
      {/* Status dot */}
      <circle cx={x + 14} cy={y + BLOCK_H / 2} r={4} fill={color} />
      {/* Label */}
      <text x={x + 26} y={y + 24} fontSize={13} fontWeight={600} fill="var(--text)" fontFamily="inherit">
        {label.length > 14 ? label.slice(0, 13) + "..." : label}
      </text>
      {/* Sub-label */}
      <text x={x + 26} y={y + 40} fontSize={10} fill="var(--muted)" fontFamily="inherit">
        {sub}
      </text>
    </g>
  );
}
