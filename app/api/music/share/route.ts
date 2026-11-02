import { NextResponse } from "next/server";
import { createShare, listShares, revokeShare } from "@/lib/db";
import { adminAccess, canAccessTrack, musicAccess, notFound } from "@/lib/music-token";
import { newShareToken, shareUrl } from "@/lib/music-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { title, kind: "track"|"album"|"list", trackIds, visibility: "public"|"private" } → a share link to exactly those songs.
// Anyone signed in may share songs they can open; they can never share what they cannot.
export async function POST(request: Request): Promise<Response> {
  const access = await musicAccess(request);
  if (!access) return notFound();
  const b = (await request.json().catch(() => ({}))) as { title?: unknown; kind?: unknown; trackIds?: unknown; visibility?: unknown };
  const ids = [...new Set((Array.isArray(b.trackIds) ? b.trackIds : []).map(Number).filter(Number.isInteger))].slice(0, 300);
  if (ids.length === 0) return NextResponse.json({ error: "no songs" }, { status: 400 });
  for (const id of ids) if (!(await canAccessTrack(access, id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  const kind = b.kind === "album" ? "album" : b.kind === "list" || ids.length > 1 ? "list" : "track";
  const share = await createShare({
    token: newShareToken(), kind, title: String(b.title ?? "").trim().slice(0, 200) || "Shared songs", trackIds: ids,
    visibility: b.visibility === "private" ? "private" : "public", linkId: access.kind === "link" ? access.linkId : 0,
  });
  return NextResponse.json({ url: shareUrl(share.token), id: share.id, visibility: share.visibility });
}

// GET → every share (admin). DELETE ?id= → switch one off.
export async function GET(request: Request): Promise<Response> {
  if (!(await adminAccess(request))) return notFound();
  return NextResponse.json({ shares: (await listShares()).map((s) => ({ ...s, url: shareUrl(s.token), token: undefined })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!(await adminAccess(request))) return notFound();
  const id = Number(new URL(request.url).searchParams.get("id"));
  return NextResponse.json({ ok: Number.isInteger(id) && (await revokeShare(id)) });
}
