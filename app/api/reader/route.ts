import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { getAllSettings, setSetting } from "@/lib/db";
import { readerChats, readerCheck, readerInfo } from "@/lib/group-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET → how the group-reading bot is doing (never the token). POST { token } → use this bot ("" switches reading off).
export async function GET(): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const s = await getAllSettings();
  const on = !!(s.tgReaderToken ?? "").trim();
  return NextResponse.json({ on, info: on ? await readerInfo() : null, chats: on ? await readerChats() : {}, auto: s.tgReaderAuto ? (JSON.parse(s.tgReaderAuto) as { dest?: string }).dest ?? null : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const token = String(((await request.json().catch(() => ({}))) as { token?: unknown }).token ?? "").trim();
  if (!token) { await setSetting("tgReaderToken", ""); await setSetting("tgReaderInfo", ""); return NextResponse.json({ ok: true, on: false }); }
  try {
    const c = await readerCheck(token);
    await setSetting("tgReaderToken", token); await setSetting("tgReaderOffset", "0");
    await setSetting("tgReaderInfo", JSON.stringify({ ...c, at: Date.now(), error: null, groups: 0, lastMessageAt: null }));
    return NextResponse.json({ ok: true, on: true, username: c.username, canReadAll: c.canReadAll });
  } catch (e) { return NextResponse.json({ error: "این توکن کار نمی‌کند: " + String(e).slice(0, 120) }, { status: 400 }); }
}
