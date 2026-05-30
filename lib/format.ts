export function relTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = typeof input === "string" ? new Date(input) : input;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

export function chatTypeLabel(t: string): string {
  switch (t) {
    case "private":
      return "DM";
    case "group":
      return "Group";
    case "supergroup":
      return "Supergroup";
    case "channel":
      return "Channel";
    default:
      return t;
  }
}
