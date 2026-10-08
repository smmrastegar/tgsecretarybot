// Lyrics for offline listening: saved next to the audio (same Cache API bucket, so "Remove all
// downloads" and sign-out wipe them too) and read back when the network is not there.
const BUCKET = "player-audio";
const keyOf = (id: number) => `/api/music/${id}/lyrics`;

export type Lyrics = { synced: string | null; plain: string | null; found: boolean };
const NONE: Lyrics = { synced: null, plain: null, found: false };

async function bucket(): Promise<Cache | null> {
  try { return "caches" in window ? await caches.open(BUCKET) : null; } catch { return null; }
}

/** Network first (and refresh the saved copy if there is one), saved copy when offline. */
export async function loadLyrics(id: number, tq: string): Promise<Lyrics> {
  const c = await bucket();
  try {
    const r = await fetch(`${keyOf(id)}?${tq}`);
    if (r.ok) {
      if (c && (await c.match(keyOf(id)))) await c.put(keyOf(id), r.clone());
      return (await r.json()) as Lyrics;
    }
  } catch { /* offline: fall through to the saved copy */ }
  try {
    const hit = c ? await c.match(keyOf(id)) : undefined;
    if (hit) return (await hit.json()) as Lyrics;
  } catch { /* ignore */ }
  return NONE;
}

/** Best effort: store this song's lyrics for offline use. */
export async function saveLyrics(id: number, tq: string): Promise<void> {
  const c = await bucket();
  if (!c) return;
  try {
    const r = await fetch(`${keyOf(id)}?${tq}`);
    if (r.ok) await c.put(keyOf(id), r);
  } catch { /* lyrics are optional */ }
}

export async function removeLyrics(id: number): Promise<void> {
  const c = await bucket();
  if (c) await c.delete(keyOf(id)).catch(() => {});
}
