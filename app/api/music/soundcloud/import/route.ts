import { NextResponse } from "next/server";
import { requireUnscopedOr403 } from "@/lib/auth";
import { listScAccounts } from "@/lib/db";
import { kickScDownloads } from "@/lib/soundcloud-kick";
import { ScRateLimited, scImport, scLikes, scPlaylistTracks, scResolve } from "@/lib/soundcloud";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST { accountId?, what: "likes" | "playlist" | "url", urn?, name?, url? }: queue songs (and mirror them into a library playlist).
export async function POST(request: Request): Promise<NextResponse> {
  const guard = await requireUnscopedOr403();
  if (guard) return guard;
  const b = (await request.json().catch(() => ({}))) as { accountId?: number; what?: string; urn?: string; name?: string; url?: string };
  const accounts = await listScAccounts();
  const acc = Number.isFinite(Number(b.accountId)) && b.accountId ? Number(b.accountId) : null;
  const who = accounts.find((a) => a.id === acc)?.username ?? "SoundCloud";
  try {
    let r;
    if (b.what === "likes" && acc) r = await scImport(await scLikes(acc), `SoundCloud likes (${who})`, acc);
    else if (b.what === "playlist" && b.urn) r = await scImport(await scPlaylistTracks(acc, b.urn), `SoundCloud: ${String(b.name ?? "playlist").slice(0, 80)}`, acc);
    else if (b.what === "url" && b.url) {
      const o = await scResolve(b.url.trim(), acc ?? accounts[0]?.id ?? null);
      r = o.kind === "track" ? await scImport([o.track], null, acc) : await scImport(o.tracks, `SoundCloud: ${o.title.slice(0, 80)}`, acc);
    } else return NextResponse.json({ error: "nothing to import" }, { status: 400 });
    kickScDownloads();
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof ScRateLimited ? "SoundCloud is limiting requests; try again in a minute" : e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
