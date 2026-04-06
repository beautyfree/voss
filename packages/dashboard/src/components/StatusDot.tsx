export function StatusDot({ status }: { status: string }) {
  const cls =
    status === "live" ? "dot-live" :
    status === "failed" ? "dot-failed" :
    status === "building" || status === "deploying" || status === "health_checking" ? "dot-building" :
    "dot-pending";

  return <span className={`dot ${cls}`} title={status} />;
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "live" ? "badge-live" :
    status === "failed" ? "badge-failed" :
    "badge-building";

  return <span className={`badge ${cls}`}><StatusDot status={status} /> {status}</span>;
}
