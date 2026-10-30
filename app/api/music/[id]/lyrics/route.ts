import { NextResponse } from "next/server";
import { canAccessTrack, editAccess, guardTrack, notFound } from "@/lib/music-token";
import { setManualLyrics } from "@/lib/music-lyrics";
import { getAllSettings, getMusicTrack, setSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Lyrics = { synced: string | null; plain: string | null; found: boolean };

// Lyrics come from LRCLIB (free, keyless). Results, including misses, are
// cached in settings so each track is looked up at most once.
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const id = Number((await ctx.params).id);
  const g = await guardTrack(request, id);
  if ("deny" in g) return g.deny;
  const key = `lyrics.${id}`;
  const cached = (await getAllSettings())[key];
  if (cached) { try { return NextResponse.json(JSON.parse(cached) as Lyrics); } catch { /* refetch */ } }
  const t = await getMusicTrack(id);
  if (!t?.title) return NextResponse.json({ synced: null, plain: null, found: false } satisfies Lyrics);
  const artist = (t.artist ?? "").split(/,\s*/)[0] ?? "";
  const qs = new URLSearchParams({ track_name: t.title, artist_name: artist });
  if (t.durationS) qs.set("duration", String(Math.round(t.durationS)));
  let out: Lyrics = { synced: null, plain: null, found: false };
  try {
    const r = await fetch(`https://lrclib.net/api/get?${qs}`, { headers: { "User-Agent": "tgsecretarybot-personal-player" }, signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const j = (await r.json()) as { syncedLyrics?: string | null; plainLyrics?: string | null };
      out = { synced: j.syncedLyrics ?? null, plain: j.plainLyrics ?? null, found: !!(j.syncedLyrics || j.plainLyrics) };
    } else if (r.status !== 404) {
      return NextResponse.json(out); // transient: don't cache
    }
  } catch { return NextResponse.json(out); }
  await setSetting(key, JSON.stringify(out));
  return NextResponse.json(out);
}

// POST multipart { text?, image? }: lyrics by hand — typed / pasted text and/or a picture of the lyrics page. The dashboard, or a player link that may edit.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const access = await editAccess(request);
  if (!access) return notFound();
  const id = Number((await ctx.params).id);
  if (!Number.isFinite(id) || !(await getMusicTrack(id)) || !(await canAccessTrack(access, id))) return NextResponse.json({ error: "no such song" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const text = form?.has("text") ? String(form.get("text") ?? "") : undefined;
  const img = form?.get("image");
  try {
    const out = await setManualLyrics(id, { text, image: img instanceof File && img.size > 0 ? new Uint8Array(await img.arrayBuffer()) : null });
    return NextResponse.json({ ok: true, ...out });
  } catch { return NextResponse.json({ error: "that file is not a readable picture" }, { status: 415 }); }
}
