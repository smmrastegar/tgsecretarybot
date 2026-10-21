"use client";

import { AccountsCtx, TitleLine } from "./SourceMarks";
import { memo, useContext, useMemo, useState } from "react";
import { CheckIcon, ChevronRightIcon, GridIcon, HeartIcon, ListIcon, MoreIcon, PlayIcon, DownloadIcon, ShareIcon, ShuffleIcon, SparkIcon } from "../Icons";
import { Card, Cover, shareText, trackShareLines, Eq, fmt, Mosaic, SectionTitle, Shelf, ts, type Playlist, type Track } from "./shared";
import { matchesAccounts } from "@/lib/music-scope";
import { setByKey } from "./sets";

// Everything the views need from the player engine.
export type Api = {
  tq: string;
  /** can this link create playlists (dashboard switch) */
  canCreate: boolean;
  /** open the "save this account filter as a playlist" sheet */
  saveAccountPlaylist: (ids: number[], mode: "any" | "all") => void;
  /** multi-select: rows show a tick box; the bar at the bottom acts on the picked songs */
  /** the server cannot be reached: songs that are not downloaded cannot play */
  offlineMode: boolean;
  selecting: boolean;
  sel: Set<number>;
  toggleSel: (id: number) => void;
  startSelect: (pool?: number[], first?: number) => void;
  tracks: Track[];
  playlists: Playlist[];
  byId: Map<number, Track>;
  cur: number | null;
  playing: boolean;
  loading: boolean;
  play: (ids: number[], startId?: number, shuffle?: boolean) => void;
  smartMix: (ids: number[]) => void;
  menu: (t: Track) => void;
  rate: (t: Track, r: number) => void;
  open: (page: Page) => void;
  vibes: Vibe[];
  desc: Record<number, Desc>;
  radio: (t: Track) => void;
  details: (t: Track) => void;
  download: (ids: number[], label: string) => void;
  offline: Set<number>;
  dl: { done: number; total: number } | null;
  analysis: { analyzed: number; ready: number };
};
export type Desc = { bpm: number; key: string; mode: string; energy: number; brightness: number; vibe: string | null; genres: string[]; moods?: Record<string, number>; vocal?: number };
export type Vibe = { key: string; name: string; trackIds: number[]; bpm: number; energy: number; brightness: number; minorShare: number; genres: string[]; moods?: Record<string, number> };
export type Page = { kind: "artist" | "album" | "playlist" | "liked" | "recent" | "top" | "vibe" | "offline" | "set" | "uploader"; key: string; title: string };

export const artistsOf = (t: Track): string[] => (t.artist ?? "Unknown").split(/,\s*/).filter(Boolean);
/** the credited artists plus the SoundCloud uploader as a second artist: used to group and find songs, not to show them */
export const findableArtists = (t: Track): string[] => (t.uploader ? [...artistsOf(t), t.uploader] : artistsOf(t));
const albumKey = (t: Track) => `${t.album ?? "Single"}|${artistsOf(t)[0] ?? ""}`;

/* ---------- rows ---------- */

/** Spotify's "downloaded" mark: a small green disc with a white arrow. */
export const DownloadedBadge = ({ size = 14 }: { size?: number }) => (
  <span role="img" aria-label="Downloaded" title="Downloaded for offline" className="inline-grid place-items-center rounded-full bg-[#1ed760] text-black shrink-0 align-[-2px]" style={{ width: size, height: size }}>
    <svg viewBox="0 0 24 24" width={size * 0.64} height={size * 0.64} fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 4v14M6 12.5l6 6 6-6" /></svg>
  </span>
);

type RowProps = { t: Track; api: Api; ids: number[]; index?: number; picked?: boolean };
function TrackRowImpl({ t, api, ids, index, picked }: RowProps) {
  const active = api.cur === t.id;
  if (picked !== undefined) {
    return (
      <button onClick={() => api.toggleSel(t.id)} role="checkbox" aria-checked={picked} className={`w-full flex items-center gap-3 py-2 text-left ${picked ? "" : "opacity-90"}`} style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}>
        <span className={`grid place-items-center w-6 h-6 rounded-full border-2 shrink-0 transition ${picked ? "bg-[var(--fg)] border-[var(--fg)] text-[var(--bg)]" : "border-[var(--dim3)]"}`}>{picked && <CheckIcon size={14} />}</span>
        <Cover t={t} tq={api.tq} size={52} radius={8} />
        <span className="min-w-0">
          <TitleLine title={t.title ?? "—"} ids={t.sources} className="text-[16px] leading-tight font-medium" />
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--dim)] mt-0.5 min-w-0">{api.offline.has(t.id) && <DownloadedBadge />}<span dir="auto" className="truncate">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</span></span>
        </span>
      </button>
    );
  }
  return (
    <div className={`flex items-center gap-3 py-2 ${t.rating < 0 || (api.offlineMode && !api.offline.has(t.id)) ? "opacity-40" : ""}`} style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}>
      <button onClick={() => api.play(ids, t.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label={`Play ${t.title ?? ""}`}>
        {index != null && <span className="w-5 text-center text-sm text-[var(--dim3)] tabular-nums shrink-0">{active ? <Eq on={api.playing} /> : index}</span>}
        <span className="relative shrink-0">
          <Cover t={t} tq={api.tq} size={52} radius={8} />
          {active && index == null && <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 text-white"><Eq on={api.playing} /></span>}
        </span>
        <span className="min-w-0">
          <TitleLine title={t.title ?? "—"} ids={t.sources} className={`text-[16px] leading-tight font-medium ${active ? "underline decoration-2 underline-offset-4" : ""}`} />
          <span className="flex items-center gap-1.5 text-[13px] text-[var(--dim)] mt-0.5 min-w-0">{api.offline.has(t.id) && <DownloadedBadge />}<span dir="auto" className="truncate">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</span></span>
        </span>
      </button>
      {t.rating > 0 && <HeartIcon size={16} filled className="text-rose-500 shrink-0" />}
      <button onClick={() => api.menu(t)} className="p-2.5 -mr-1.5 text-[var(--dim)] hover:text-[var(--fg)] shrink-0" aria-label="More options"><MoreIcon size={22} /></button>
    </div>
  );
}

// A row only re-renders when its own track, position, or "is this the one
// playing" state changes — not on every progress tick or unrelated update.
export const TrackRow = memo(TrackRowImpl, (a, b) => {
  const act = a.api.cur === a.t.id;
  return a.t === b.t && a.picked === b.picked && a.ids === b.ids && a.index === b.index && a.api.tq === b.api.tq && a.api.offlineMode === b.api.offlineMode && a.api.offline.has(a.t.id) === b.api.offline.has(b.t.id) && a.api.play === b.api.play
    && act === (b.api.cur === b.t.id) && (!act || a.api.playing === b.api.playing);
});

export function TrackList({ list, api, numbered }: { list: Track[]; api: Api; numbered?: boolean }) {
  const ids = useMemo(() => list.map((t) => t.id), [list]);
  if (api.loading) return <Skeleton />;
  if (list.length === 0) return <Empty text="Nothing here yet." />;
  return <div className="divide-y divide-[var(--bd0)]">{list.map((t, i) => <TrackRow key={t.id} t={t} api={api} ids={ids} index={numbered ? i + 1 : undefined} picked={api.selecting ? api.sel.has(t.id) : undefined} />)}</div>;
}

export function Skeleton() {
  return (
    <div className="space-y-4 py-2" aria-hidden>
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="w-[52px] h-[52px] rounded-lg bg-[var(--s2)]" />
          <div className="flex-1 space-y-2"><div className="h-3.5 w-2/3 rounded bg-[var(--s2)]" /><div className="h-3 w-1/3 rounded bg-[var(--s1)]" /></div>
        </div>
      ))}
    </div>
  );
}
export const Empty = ({ text }: { text: string }) => <div className="py-14 text-center text-sm text-[var(--dim)]">{text}</div>;

/* ---------- collections ---------- */

export function useCollections(tracks: Track[], playlists: Playlist[], byId: Map<number, Track>) {
  return useMemo(() => {
    const ready = tracks.filter((t) => t.status === "ready");
    const artists = new Map<string, Track[]>();
    const albums = new Map<string, Track[]>();
    for (const t of ready) {
      for (const a of findableArtists(t)) artists.set(a, [...(artists.get(a) ?? []), t]);
      albums.set(albumKey(t), [...(albums.get(albumKey(t)) ?? []), t]);
    }
    const lists = playlists.map((p) => ({ p, tracks: p.trackIds.map((id) => byId.get(id)).filter((t): t is Track => !!t && t.status === "ready") }));
    return {
      ready, artists, albums, lists,
      liked: ready.filter((t) => t.rating > 0),
      recent: [...ready].filter((t) => t.lastPlayedAt).sort((a, b) => ts(b.lastPlayedAt) - ts(a.lastPlayedAt)),
      top: [...ready].filter((t) => t.playCount > 0).sort((a, b) => b.playCount - a.playCount || b.listenSeconds - a.listenSeconds),
      added: [...ready].sort((a, b) => ts(b.readyAt ?? b.createdAt) - ts(a.readyAt ?? a.createdAt)),
    };
  }, [tracks, playlists, byId]);
}
export type Collections = ReturnType<typeof useCollections>;

/* ---------- Home ---------- */

export function HomeView({ api, c }: { api: Api; c: Collections }) {
  const quick = [
    { title: "Liked Songs", sub: `${c.liked.length} ${c.liked.length === 1 ? "song" : "songs"}`, cover: <span className="grid place-items-center w-full h-full bg-gradient-to-br from-rose-500 to-fuchsia-700 text-white"><HeartIcon size={26} filled /></span>, go: () => api.open({ kind: "liked", key: "liked", title: "Liked Songs" }) },
    ...(api.offline.size > 0 ? [{ title: "Downloaded", sub: `${c.ready.filter((t) => api.offline.has(t.id)).length} songs`, cover: <span className="grid place-items-center w-full h-full bg-gradient-to-br from-[#1ed760] to-emerald-800 text-black"><DownloadIcon size={26} /></span>, go: () => api.open({ kind: "offline", key: "offline", title: "Downloaded" }) }] : []),
    { title: "Smart Mix", sub: "Made for you", cover: <span className="grid place-items-center w-full h-full bg-gradient-to-br from-indigo-500 to-sky-600 text-white"><SparkIcon size={26} /></span>, go: () => api.smartMix(c.ready.map((t) => t.id)) },
    ...c.lists.slice(0, 4).map(({ p, tracks }) => ({ title: p.name, sub: `${tracks.length} songs`, cover: <Mosaic tracks={tracks} tq={api.tq} size="100%" radius={0} />, go: () => api.open({ kind: "playlist", key: String(p.id), title: p.name }) })),
  ];
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5 mt-4">
        {quick.map((q) => (
          <button key={q.title} onClick={q.go} className="flex items-center gap-3 rounded-lg bg-[var(--s1)] overflow-hidden text-left active:scale-[.97] transition">
            <span className="w-14 h-14 shrink-0 overflow-hidden block">{q.cover}</span>
            <span className="min-w-0 pr-2"><span className="block text-[14px] font-semibold leading-tight truncate">{q.title}</span><span className="block text-[11px] text-[var(--dim)] truncate">{q.sub}</span></span>
          </button>
        ))}
      </div>
      {api.loading && <Skeleton />}
      {c.recent.length > 0 && (<><SectionTitle>Jump back in</SectionTitle><Shelf>{c.recent.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} ids={t.sources} subtitle={t.artist ?? ""} onClick={() => api.play(c.recent.map((x) => x.id), t.id)} />)}</Shelf></>)}
      {c.top.length > 0 && (<><SectionTitle action={<button onClick={() => api.open({ kind: "top", key: "top", title: "Most played" })} className="text-sm text-[var(--dim)]">See all</button>}>Most played</SectionTitle><Shelf>{c.top.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} ids={t.sources} subtitle={`${t.playCount} plays`} onClick={() => api.play(c.top.map((x) => x.id), t.id)} />)}</Shelf></>)}
      {c.lists.length > 0 && (<><SectionTitle>Your playlists</SectionTitle><Shelf>{c.lists.map(({ p, tracks }) => <Card key={p.id} cover={<Mosaic tracks={tracks} tq={api.tq} size={144} radius={0} />} title={p.name} subtitle={`${tracks.length} songs`} onClick={() => api.open({ kind: "playlist", key: String(p.id), title: p.name })} />)}</Shelf></>)}
      {api.vibes.length > 0 ? (
        <>
          <SectionTitle>Your vibes</SectionTitle>
          <Shelf>{api.vibes.map((v) => {
            const ts_ = v.trackIds.map((id) => api.byId.get(id)).filter((t): t is Track => !!t);
            return <Card key={v.key} cover={<Mosaic tracks={ts_} tq={api.tq} size={144} radius={0} />} title={v.name} subtitle={`${ts_.length} songs · ~${v.bpm} BPM`} onClick={() => api.open({ kind: "vibe", key: v.key, title: v.name })} />;
          })}</Shelf>
          {api.analysis.analyzed < api.analysis.ready && <div className="mt-2 text-[12px] text-[var(--dim3)]">Still listening to your library: {api.analysis.analyzed} of {api.analysis.ready} songs analysed.</div>}
        </>
      ) : api.analysis.ready > 0 && api.analysis.analyzed < api.analysis.ready && <div className="mt-6 text-[12px] text-[var(--dim3)]">Vibes appear once your library is analysed ({api.analysis.analyzed} of {api.analysis.ready} songs so far).</div>}
      {c.added.length > 0 && (<><SectionTitle>Recently added</SectionTitle><Shelf>{c.added.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} ids={t.sources} subtitle={t.artist ?? ""} onClick={() => api.play(c.added.map((x) => x.id), t.id)} />)}</Shelf></>)}
    </div>
  );
}

/* ---------- Library ---------- */

type Sort = "recent" | "az" | "plays" | "artist";
const SORTS: Array<[Sort, string]> = [["recent", "Recently added"], ["az", "Title A–Z"], ["plays", "Most played"], ["artist", "Artist"]];

export function LibraryView({ api, c }: { api: Api; c: Collections }) {
  const [seg, setSeg] = useState<"songs" | "artists" | "albums" | "playlists">("songs");
  const [sort, setSort] = useState<Sort>("recent");
  const [grid, setGrid] = useState(false);
  const [likedOnly, setLikedOnly] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  // Filter by the Spotify account(s) a song came from: songs from ANY of the chosen accounts, or from ALL of them.
  const accounts = useContext(AccountsCtx);
  const [accSel, setAccSel] = useState<number[]>([]);
  const [accMode, setAccMode] = useState<"any" | "all">("any");
  const songs = useMemo(() => {
    let base = likedOnly ? c.liked : c.ready;
    if (savedOnly || api.offlineMode) base = base.filter((t) => api.offline.has(t.id));
    if (accSel.length) base = base.filter((t) => matchesAccounts(t.sources, accSel, accMode));
    const cmp: Record<Sort, (a: Track, b: Track) => number> = {
      recent: (a, b) => ts(b.readyAt ?? b.createdAt) - ts(a.readyAt ?? a.createdAt),
      az: (a, b) => (a.title ?? "").localeCompare(b.title ?? ""),
      plays: (a, b) => b.playCount - a.playCount,
      artist: (a, b) => (a.artist ?? "").localeCompare(b.artist ?? "") || (a.title ?? "").localeCompare(b.title ?? ""),
    };
    return [...base].sort(cmp[sort]);
  }, [c, sort, likedOnly, savedOnly, accSel, accMode, api.offline, api.offlineMode]);
  const artists = useMemo(() => [...c.artists.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])), [c.artists]);
  const albums = useMemo(() => [...c.albums.entries()].sort((a, b) => a[0].localeCompare(b[0])), [c.albums]);
  const segBtn = (k: typeof seg, label: string) => (
    <button key={k} onClick={() => setSeg(k)} className={`px-4 py-2 rounded-full text-[14px] font-semibold whitespace-nowrap transition ${seg === k ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}>{label}</button>
  );
  return (
    <div>
      <div className="flex gap-2 mt-4 overflow-x-auto -mx-4 px-4 [scrollbar-width:none]">
        {segBtn("songs", "Songs")}{segBtn("artists", "Artists")}{segBtn("albums", "Albums")}{segBtn("playlists", "Playlists")}
      </div>

      {seg === "songs" && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-4">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent text-[14px] font-semibold text-[var(--dim2)] outline-none">
              {SORTS.map(([k, l]) => <option key={k} value={k} className="text-black">{l}</option>)}
            </select>
            <button onClick={() => setLikedOnly((v) => !v)} className={`ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold ${likedOnly ? "bg-rose-500/20 text-rose-500" : "bg-[var(--s1)] text-[var(--dim2)]"}`}><HeartIcon size={14} filled={likedOnly} /> Liked</button>
            {api.offline.size > 0 && !api.offlineMode && <button onClick={() => setSavedOnly((v) => !v)} aria-pressed={savedOnly} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold ${savedOnly ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}><DownloadIcon size={14} /> Saved</button>}
            <span className="flex-1" />
            <button onClick={() => api.startSelect(songs.map((t) => t.id))} className="p-2 text-[var(--dim2)]" aria-label="Select songs"><CheckIcon size={22} /></button>
            <button onClick={() => api.play(songs.map((t) => t.id), undefined, true)} className="p-2 text-[var(--dim2)]" aria-label="Shuffle"><ShuffleIcon size={22} /></button>
            <button onClick={() => setGrid((g) => !g)} className="p-2 text-[var(--dim2)]" aria-label={grid ? "List view" : "Grid view"}>{grid ? <ListIcon size={22} /> : <GridIcon size={22} />}</button>
          </div>
          {accounts.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 overflow-x-auto -mx-4 px-4 [scrollbar-width:none]">
                {accounts.map((a) => {
                  const on = accSel.includes(a.id);
                  const letter = (a.name.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "?").toUpperCase();
                  return (
                    <button key={a.id} onClick={() => setAccSel((s) => (on ? s.filter((x) => x !== a.id) : [...s, a.id]))} role="checkbox" aria-checked={on}
                      className={`shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-[13px] font-semibold transition ${on ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}>
                      <span className={`grid place-items-center w-5 h-5 rounded-full text-[10px] font-bold ${on ? "bg-[var(--bg)] text-[var(--fg)]" : "bg-[var(--s2)]"}`}>{letter}</span>
                      <span className="whitespace-nowrap">{a.name}</span>
                    </button>
                  );
                })}
              </div>
              {accSel.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--dim)]">
                  <span className="tabular-nums whitespace-nowrap">{songs.length} {songs.length === 1 ? "song" : "songs"}</span>
                  {accSel.length > 1 && (
                    <button onClick={() => setAccMode((m) => (m === "any" ? "all" : "any"))} aria-label="Match any or all selected accounts"
                      className="whitespace-nowrap px-2.5 py-1 rounded-full text-[12px] font-semibold border border-[var(--bd)] text-[var(--dim2)]">
                      {accMode === "any" ? "In any of them" : "In all of them"} ⇄
                    </button>
                  )}
                  <span className="flex items-center gap-4 ml-auto whitespace-nowrap">
                    <button onClick={() => setAccSel([])} className="font-semibold text-[var(--dim2)]">Clear</button>
                    {api.canCreate && songs.length > 0 && <button onClick={() => api.saveAccountPlaylist(accSel, accMode)} className="font-semibold text-[var(--fg)]">＋ Save as playlist</button>}
                  </span>
                </div>
              )}
            </div>
          )}
          {grid ? (
            <div className="grid grid-cols-2 gap-4 mt-3">
              {songs.map((t) => (
                <button key={t.id} onClick={() => api.play(songs.map((x) => x.id), t.id)} className="text-left active:scale-[.97] transition" style={{ contentVisibility: "auto", containIntrinsicSize: "0 200px" }}>
                  <Cover t={t} tq={api.tq} size="100%" radius={12} className="aspect-square shadow-lg" res={320} />
                  <div className="mt-2 text-[15px] font-semibold"><TitleLine title={t.title} ids={t.sources} /></div>
                  <div className="text-[13px] text-[var(--dim)] truncate">{t.artist}</div>
                </button>
              ))}
            </div>
          ) : <div className="mt-1"><TrackList list={songs} api={api} /></div>}
        </>
      )}

      {seg === "artists" && (
        <div className="mt-3 divide-y divide-[var(--bd0)]">
          {artists.map(([name, list]) => (
            <button key={name} onClick={() => api.open({ kind: "artist", key: name, title: name })} className="w-full flex items-center gap-3 py-2.5 text-left" style={{ contentVisibility: "auto", containIntrinsicSize: "0 68px" }}>
              <span className="w-14 h-14 rounded-full overflow-hidden shrink-0 block"><Cover t={list[0]!} tq={api.tq} size="100%" radius={0} res={128} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{name}</span><span className="block text-[13px] text-[var(--dim)]">{list.length} {list.length === 1 ? "song" : "songs"}</span></span>
              <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
            </button>
          ))}
        </div>
      )}

      {seg === "albums" && (
        <div className="grid grid-cols-2 gap-4 mt-4">
          {albums.map(([key, list]) => (
            <button key={key} onClick={() => api.open({ kind: "album", key, title: list[0]!.album ?? "Singles" })} className="text-left active:scale-[.97] transition" style={{ contentVisibility: "auto", containIntrinsicSize: "0 210px" }}>
              <Cover t={list[0]!} tq={api.tq} size="100%" radius={12} className="aspect-square shadow-lg" res={320} />
              <div className="mt-2 text-[15px] font-semibold truncate">{list[0]!.album ?? "Singles"}</div>
              <div className="text-[13px] text-[var(--dim)] truncate">{artistsOf(list[0]!)[0]} · {list.length}</div>
            </button>
          ))}
        </div>
      )}

      {seg === "playlists" && (
        <div className="mt-3 divide-y divide-[var(--bd0)]">
          <button onClick={() => api.open({ kind: "liked", key: "liked", title: "Liked Songs" })} className="w-full flex items-center gap-3 py-2.5 text-left">
            <span className="w-14 h-14 rounded-lg shrink-0 grid place-items-center bg-gradient-to-br from-rose-500 to-fuchsia-700 text-white"><HeartIcon size={24} filled /></span>
            <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium">Liked Songs</span><span className="block text-[13px] text-[var(--dim)]">{c.liked.length} songs</span></span>
          </button>
          {api.offline.size > 0 && (
            <button onClick={() => api.open({ kind: "offline", key: "offline", title: "Downloaded" })} className="w-full flex items-center gap-3 py-2.5 text-left">
              <span className="w-14 h-14 rounded-lg shrink-0 grid place-items-center bg-gradient-to-br from-[#1ed760] to-emerald-800 text-black"><DownloadIcon size={24} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium">Downloaded</span><span className="block text-[13px] text-[var(--dim)]">{c.ready.filter((t) => api.offline.has(t.id)).length} songs · play without internet</span></span>
            </button>
          )}
          {c.lists.map(({ p, tracks }) => (
            <button key={p.id} onClick={() => api.open({ kind: "playlist", key: String(p.id), title: p.name })} className="w-full flex items-center gap-3 py-2.5 text-left">
              <Mosaic tracks={tracks} tq={api.tq} size={56} radius={8} />
              <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{p.name}</span><span className="block text-[13px] text-[var(--dim)]">{tracks.length} songs</span></span>
              <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
            </button>
          ))}
          {c.lists.length === 0 && <Empty text="Playlists you create in the dashboard show up here." />}
        </div>
      )}
    </div>
  );
}

/* ---------- Detail page (artist / album / playlist / liked / …) ---------- */

export function DetailView({ page, api, c }: { page: Page; api: Api; c: Collections }) {
  const list = useMemo(() => {
    switch (page.kind) {
      case "artist": return c.artists.get(page.key) ?? [];
      case "album": return c.albums.get(page.key) ?? [];
      case "uploader": return c.ready.filter((t) => (t.uploadedBy ?? "").toLowerCase() === page.key.toLowerCase());
      case "playlist": return c.lists.find((l) => String(l.p.id) === page.key)?.tracks ?? [];
      case "liked": return c.liked;
      case "recent": return c.recent;
      case "offline": return c.ready.filter((t) => api.offline.has(t.id));
      case "set": { const st = setByKey(page.key); return st ? c.ready.filter((t) => st.test(t, api.desc[t.id])) : []; }
      case "top": return c.top;
      case "vibe": return (api.vibes.find((v) => v.key === page.key)?.trackIds ?? []).map((id) => api.byId.get(id)).filter((t): t is Track => !!t);
    }
  }, [page, c, api.vibes, api.byId, api.offline, api.desc]);
  const ids = list.map((t) => t.id);
  const vb = page.kind === "vibe" ? api.vibes.find((v) => v.key === page.key) : null;
    const totalS = list.reduce((n, t) => n + (t.durationS ?? 0), 0);
  const mins = Math.round(totalS / 60);
  const length = totalS ? (mins >= 60 ? `${Math.floor(mins / 60)} hr ${mins % 60} min` : `${mins} min`) : null;
  const year = (list.map((t) => (t.releaseDate ?? "").slice(0, 4)).filter((y) => /^\d{4}$/.test(y)).sort().pop()) ?? null;
  const kindLabel = vb ? "Vibe" : page.kind === "uploader" ? "Uploader" : page.kind === "artist" ? "Artist" : page.kind === "album" ? "Album" : page.kind === "liked" ? "Playlist" : "Playlist";
  const byline = page.kind === "album" && list[0] ? artistsOf(list[0])[0] : page.kind === "artist" || page.kind === "uploader" ? null : "Your library";
  const meta = [kindLabel, year, `${list.length} ${list.length === 1 ? "song" : "songs"}`, length].filter(Boolean).join(" • ");
  const left = ids.filter((id) => !api.offline.has(id)).length;
  const allDown = left === 0 && ids.length > 0;
  const iconBtn = "w-11 h-11 grid place-items-center rounded-full text-[var(--dim2)] active:scale-95 transition";
  return (
    <div>
      {/* Spotify-style header: a tinted wash from the artwork colour, the cover centred, everything else left-aligned */}
      <div className="-mx-4 -mt-1 px-4 pt-4 pb-1" style={{ background: "linear-gradient(to bottom, rgba(var(--ac), .38), rgba(var(--ac), .10) 70%, transparent)" }}>
        <div className="mx-auto w-[min(68vw,18rem)] aspect-square overflow-hidden shadow-2xl" style={{ borderRadius: page.kind === "artist" || page.kind === "uploader" ? "9999px" : "6px" }}>
          {page.kind === "liked" ? <span className="grid place-items-center w-full h-full bg-gradient-to-br from-rose-500 to-fuchsia-700 text-white"><HeartIcon size={72} filled /></span>
            : page.kind === "offline" ? <span className="grid place-items-center w-full h-full bg-gradient-to-br from-[#1ed760] to-emerald-800 text-black"><DownloadIcon size={84} /></span>
            : page.kind === "playlist" || page.kind === "top" || page.kind === "recent" || page.kind === "vibe" || page.kind === "set" ? <Mosaic tracks={list} tq={api.tq} size="100%" radius={0} />
            : list[0] ? <Cover t={list[0]} tq={api.tq} size="100%" radius={0} /> : null}
        </div>
        <h2 className="mt-5 text-[26px] font-extrabold tracking-tight leading-[1.15] break-words" style={{ textWrap: "balance" }}>{page.title}</h2>
        {byline && (
          <div className="mt-2 flex items-center gap-2 text-[14px] font-semibold">
            {list[0] && <span className="w-6 h-6 rounded-full overflow-hidden block shrink-0"><Cover t={list[0]} tq={api.tq} size="100%" radius={0} res={128} /></span>}
            <span className="break-words min-w-0">{byline}</span>
          </div>
        )}
        <div className="mt-1.5 text-[13px] text-[var(--dim)]">{meta}</div>
        <div className="mt-3 flex items-center gap-1">
          <button onClick={() => left > 0 && !api.dl && api.download(ids, page.title)} disabled={allDown || !!api.dl} aria-label={allDown ? "Downloaded for offline" : "Download for offline"}
            className={`${iconBtn} ${api.dl ? "w-auto px-3 gap-1.5 text-[13px] font-semibold tabular-nums" : ""} ${allDown ? "text-[rgb(var(--ac))]" : ""}`}>
            {api.dl ? `${api.dl.done}/${api.dl.total}` : allDown ? <CheckIcon size={22} /> : <DownloadIcon size={22} />}
          </button>
          <button onClick={() => void shareText(page.title, [`${page.title} — ${list.length} songs`, "", ...list.slice(0, 50).flatMap((t) => [...trackShareLines(t, api.tq), ""])])} className={iconBtn} aria-label="Share"><ShareIcon size={21} /></button>
          <button onClick={() => api.startSelect(ids)} className={iconBtn} aria-label="Select songs"><CheckIcon size={22} /></button>
          <span className="flex-1" />
          <button onClick={() => api.play(ids, undefined, true)} className={iconBtn} aria-label="Shuffle"><ShuffleIcon size={24} /></button>
          <button onClick={() => list[0] && api.play(ids, ids[0])} disabled={!list[0]} aria-label="Play" className="w-14 h-14 grid place-items-center rounded-full bg-[rgb(var(--ac))] text-[var(--acfg)] shadow-lg active:scale-95 transition disabled:opacity-40"><PlayIcon size={26} /></button>
        </div>
      </div>
      <div className="mt-3"><TrackList list={list} api={api} numbered={page.kind === "album"} /></div>
    </div>
  );
}

/* ---------- Search ---------- */

export const PlayGlyph = PlayIcon;
