// Shown all over a Persian dashboard, so it answers in Persian with
// Persian digits. Anything that isn't a usable date returns the em-dash
// rather than throwing — this runs inside list rendering, where one bad
// row used to take the whole page down.
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
function faNum(n: number): string {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[Number(d)]!);
}

export function relTime(input: string | Date | null | undefined): string {
  if (!input) return "—";
  const d = input instanceof Date ? input : new Date(input as string);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) return "—";
  const diff = (Date.now() - ms) / 1000;
  if (diff < 0) return "همین الان";
  if (diff < 60) return "همین الان";
  if (diff < 3600) return `${faNum(Math.floor(diff / 60))} دقیقه پیش`;
  if (diff < 86400) return `${faNum(Math.floor(diff / 3600))} ساعت پیش`;
  if (diff < 86400 * 30) return `${faNum(Math.floor(diff / 86400))} روز پیش`;
  if (diff < 86400 * 365) return `${faNum(Math.floor(diff / (86400 * 30)))} ماه پیش`;
  return `${faNum(Math.floor(diff / (86400 * 365)))} سال پیش`;
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
