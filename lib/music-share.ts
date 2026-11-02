// Share links. A share is a link to a handful of songs (one song, an album, a list) — never to the player: it carries no player token, opens only
// those songs, and cannot reach anything else. Public: anyone with the link. Private: the viewer must be signed in to My Music (their own link or
// the dashboard) — the link alone is not enough.
import { randomBytes } from "node:crypto";
import { getShare, listMusicTracks, type MusicShare } from "./db";
import { isHiddenTrack, musicAccess, notFound } from "./music-token";

export const newShareToken = () => randomBytes(18).toString("base64url");
export const shareUrl = (token: string) => `${(process.env.PLAYER_APP_URL || "https://playlist.bz").replace(/\/$/, "")}/s/${token}`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });

/** The live share for this token if the viewer may open it, else the response to send back (404 for an unknown / revoked share, 401 {private:true} when a private one needs a sign-in). */
export async function shareGate(request: Request, token: string): Promise<{ share: MusicShare } | { deny: Response }> {
  const share = token.length >= 16 && token.length <= 64 ? await getShare(token).catch(() => null) : null;
  if (!share) return { deny: notFound() };
  if (share.visibility === "private" && !(await musicAccess(request))) return { deny: json({ private: true, error: "sign in to open this share" }, 401) };
  return { share };
}

/** The songs of a share that are still there: ready and not hidden, in the order they were shared. */
export async function shareTracks(share: MusicShare) {
  const all = new Map((await listMusicTracks()).map((t) => [t.id, t]));
  return share.trackIds.map((id) => all.get(id)).filter((t): t is NonNullable<typeof t> => !!t && t.status === "ready");
}

/** One song of a share, checked cheaply (media requests come in dozens): it must be in the share and not hidden. */
export async function shareAllows(share: MusicShare, id: number): Promise<boolean> {
  return Number.isInteger(id) && share.trackIds.includes(id) && !(await isHiddenTrack(id));
}

export { json as shareJson };
