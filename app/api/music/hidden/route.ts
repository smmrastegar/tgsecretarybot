import { NextResponse } from "next/server";
import { getMusicTrack, listHiddenTracks, setTrackHidden } from "@/lib/db";
import { adminAccess, forgetHiddenCache, notFound } from "@/lib/music-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Hidden songs — admin only (the dashboard login or the Main link).
// GET → the hidden songs with the reason each was hidden.
export async function GET(request: Request): Promise<Response> {
  if (!(await adminAccess(request))) return notFound();
  return NextResponse.json({ tracks: await listHiddenTracks() }, { headers: { "Cache-Control": "no-store" } });
}

// POST { id, reason } → hide a song everywhere (the reason is required).
export async function POST(request: Request): Promise<Response> {
  if (!(await adminAccess(request))) return notFound();
  const b = (await request.json().catch(() => ({}))) as { id?: unknown; reason?: unknown };
  const id = Number(b.id), reason = typeof b.reason === "string" ? b.reason.trim() : "";
  if (!Number.isInteger(id) || !(await getMusicTrack(id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  if (!reason) return NextResponse.json({ error: "say why it is hidden" }, { status: 400 });
  await setTrackHidden(id, reason);
  forgetHiddenCache();
  return NextResponse.json({ ok: true });
}

// DELETE ?id= → bring a hidden song back.
export async function DELETE(request: Request): Promise<Response> {
  if (!(await adminAccess(request))) return notFound();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const ok = await setTrackHidden(id, null);
  forgetHiddenCache();
  return NextResponse.json({ ok });
}
