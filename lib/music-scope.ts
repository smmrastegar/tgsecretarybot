// "Songs from these Spotify accounts" filtering, shared by the server (link scope, smart playlists) and the player UI.
// Songs that came from no connected account (followed artists, pasted links) belong to the pseudo-account 0, so
// they can be picked — and are never silently hidden just because a filter is on.
export const DIRECT_ACCOUNT = { id: 0, name: "Direct" } as const;

export function matchesAccounts(sources: number[] | undefined, ids: number[], mode: "any" | "all"): boolean {
  if (!ids.length) return true;
  const have = sources && sources.length ? sources : [0];
  return mode === "all" ? ids.every((a) => have.includes(a)) : ids.some((a) => have.includes(a));
}
