// Which media counts as the FINAL result of a link-download relay.
//
// The Spotify downloader answers a link with a track card first (a
// photo: cover art + buttons) and the audio file half a minute later.
// Returning the first media message that showed up meant the contact
// got the cover and the job was closed before the song existed. Each
// downloader kind therefore names the media kinds that are a real
// result; anything else is chatter and must not consume the job.
const FINAL_KINDS: Record<string, string[]> = {
  spotify: ["audio", "document"],
  youtube: ["video", "audio", "document"],
  instagram: ["photo", "video", "document", "animation"],
};

export function isFinalDownloadMedia(downloaderKind: string, mediaKind: string): boolean {
  const allowed = FINAL_KINDS[downloaderKind.toLowerCase()];
  if (!allowed) return true; // unknown downloader: keep the old behaviour
  return allowed.includes(mediaKind);
}
