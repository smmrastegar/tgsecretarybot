import { NextResponse } from "next/server";
import { reportError } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Browser crash reports (beacon from lib/client-report.ts). Public on purpose — a crashed page may not be signed in —
// so it is small, rate-limited per address, and only ever writes one System Log row.
const hits = new Map<string, { n: number; since: number }>();
const MAX_PER_WINDOW = 20, WINDOW = 10 * 60_000;

export async function POST(request: Request): Promise<NextResponse> {
  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.since > WINDOW) hits.set(ip, { n: 1, since: now });
  else if (++h.n > MAX_PER_WINDOW) return NextResponse.json({ ok: false }, { status: 429 });
  if (hits.size > 500) for (const [k, v] of hits) if (now - v.since > WINDOW) hits.delete(k);

  const raw = await request.text().catch(() => "");
  if (raw.length > 4000) return NextResponse.json({ ok: false }, { status: 413 });
  let b: Record<string, unknown> = {};
  try { b = JSON.parse(raw) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const s = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  const message = s(b.message, 500);
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });
  const err = new Error(message);
  err.stack = s(b.stack, 1800) || undefined;
  reportError("client", `${s(b.kind, 40)} ${s(b.path, 120)} ${s(b.extra, 200)} [${b.online === false ? "offline" : "online"}] ${s(b.ua, 160)}`.trim(), err);
  return NextResponse.json({ ok: true });
}
