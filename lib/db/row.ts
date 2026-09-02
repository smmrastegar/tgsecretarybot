// Typed accessors for a raw database row.
//
// Every mapper in lib/db takes Record<string, unknown> and reaches into
// it with `r.col as string` — 309 such casts. A cast is a promise, not a
// check: a NULL where a string was assumed becomes "undefined" in the
// UI, a numeric string stays a string, a date stays whatever the driver
// gave back. These accessors make the shape explicit at the one place
// it can be enforced, and coerce the driver differences (bigint as
// string, timestamps as string on some drivers) in one spot.

export type Row = Record<string, unknown>;

export function str(r: Row, col: string): string {
  const v = r[col];
  return v == null ? "" : String(v);
}

export function strOrNull(r: Row, col: string): string | null {
  const v = r[col];
  if (v == null) return null;
  const s = String(v);
  return s === "" ? null : s;
}

export function num(r: Row, col: string, fallback = 0): number {
  const v = r[col];
  if (v == null) return fallback;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function numOrNull(r: Row, col: string): number | null {
  const v = r[col];
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

// Postgres booleans arrive as booleans; MySQL/TiDB as 0/1; a text
// driver may hand back "t"/"f". Treat all of them as booleans.
export function bool(r: Row, col: string, fallback = false): boolean {
  const v = r[col];
  if (v == null) return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = String(v).toLowerCase();
  if (s === "t" || s === "true" || s === "1") return true;
  if (s === "f" || s === "false" || s === "0") return false;
  return fallback;
}

export function date(r: Row, col: string): Date {
  return dateOrNull(r, col) ?? new Date(NaN);
}

export function dateOrNull(r: Row, col: string): Date | null {
  const v = r[col];
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}
