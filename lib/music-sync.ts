import { addMusicTrack, createMusicPlaylist, getAllSettings, listMusicPlaylists, setPlaylistTrack, setSetting } from "@/lib/db";
import { kickMusicQueue } from "@/lib/music";
import { fetchTrackIds, listMyPlaylists, listSpotifyAccounts } from "@/lib/spotify";

// Keeps imported Spotify playlists / liked songs in step with Spotify:
// every source is re-read periodically and anything new is queued for
// download and added to the matching library playlist. Sources are the
// lists imported before (stored in settings.musicSyncSources).
export type SyncSource = { accountId: number; id: string; name: string };
export const SYNC_EVERY_MS = 60 * 60 * 1000;

export async function getSyncSources(): Promise<SyncSource[]> {
  try { return JSON.parse((await getAllSettings()).musicSyncSources || "[]") as SyncSource[]; } catch { return []; }
}
export async function registerSyncSource(src: SyncSource): Promise<void> {
  const cur = await getSyncSources();
  if (cur.some((s) => s.accountId === src.accountId && s.id === src.id)) return;
  await setSetting("musicSyncSources", JSON.stringify([...cur, src]));
}

/** Read one source; queue + add everything not yet in the library. */
export async function syncSource(src: SyncSource): Promise<{ total: number; added: number }> {
  const items = await fetchTrackIds(src.accountId, src.id);
  const existing = (await listMusicPlaylists()).find((p) => p.name === src.name);
  const plId = existing?.id ?? (await createMusicPlaylist(src.name));
  let added = 0;
  for (const t of items) {
    const r = await addMusicTrack(t.id, `https://open.spotify.com/track/${t.id}`);
    if (r.created) added++;
    await setPlaylistTrack(plId, r.track.id, true);
  }
  return { total: items.length, added };
}

/** One-off: playlists imported before auto-sync existed are matched by name. */
async function backfillSources(): Promise<void> {
  const libNames = new Set((await listMusicPlaylists()).map((p) => p.name));
  for (const a of await listSpotifyAccounts()) {
    const lib = await listMyPlaylists(a.id);
    for (const p of lib.playlists) if (libNames.has(p.name)) await registerSyncSource({ accountId: a.id, id: p.id, name: p.name });
    const likedName = `لایک‌ها (${lib.me})`;
    if (libNames.has(likedName)) await registerSyncSource({ accountId: a.id, id: "liked", name: likedName });
  }
}

export async function runSync(): Promise<{ sources: number; added: number; errors: string[] }> {
  const s = await getAllSettings();
  if (s.musicSyncBackfill !== "done") { await backfillSources(); await setSetting("musicSyncBackfill", "done"); }
  const sources = await getSyncSources();
  let added = 0; const errors: string[] = [];
  for (const src of sources) {
    try { added += (await syncSource(src)).added; } catch (e) { errors.push(`${src.name}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  await setSetting("musicSyncLast", String(Date.now()));
  if (added > 0) await kickMusicQueue().catch(() => {});
  return { sources: sources.length, added, errors };
}
