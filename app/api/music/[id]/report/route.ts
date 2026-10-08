import { NextResponse } from "next/server";
import { guardTrack } from "@/lib/music-token";
import { addMusicReport, getMusicTrack, listMusicReports } from "@/lib/db";
import { reportWarn } from "@/lib/report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { reasons: string[], note?: string, context?: object } — "this song has a problem".
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const b = (await request.json().catch(() => ({}))) as { reasons?: unknown; note?: unknown; context?: unknown };
  const reasons = Array.isArray(b.reasons) ? b.reasons.map(String) : [];
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!Number.isFinite(id) || !(await getMusicTrack(id))) return NextResponse.json({ error: "no such track" }, { status: 404 });
  if (reasons.length === 0 && !note) return NextResponse.json({ error: "pick a reason or write a note" }, { status: 400 });
  // Flood guard: this track already has 5 open reports.
  const open = (await listMusicReports("open")).filter((r) => r.trackId === id).length;
  if (open >= 5) return NextResponse.json({ ok: true, deduped: true });
  const context = b.context && typeof b.context === "object" ? (b.context as Record<string, unknown>) : {};
  const rid = await addMusicReport(id, reasons, note, context);
  reportWarn("music", `track report #${rid} (track ${id}): ${reasons.join(", ") || "note only"}${note ? ` — ${note.slice(0, 120)}` : ""}`);
  return NextResponse.json({ ok: true, id: rid });
}
