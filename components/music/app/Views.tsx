"use client";

import { useMemo, useState } from "react";
import { ChevronRightIcon, GridIcon, HeartIcon, ListIcon, MoreIcon, PlayIcon, SearchIcon, ShareIcon, ShuffleIcon, SparkIcon } from "../Icons";
import { Card, Cover, shareText, trackShareLines, Eq, fmt, Mosaic, PlayAllButton, SectionTitle, Shelf, ts, type Playlist, type Track } from "./shared";

// Everything the views need from the player engine.
export type Api = {
  tq: string;
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
};
export type Page = { kind: "artist" | "album" | "playlist" | "liked" | "recent" | "top"; key: string; title: string };

export const artistsOf = (t: Track): string[] => (t.artist ?? "Unknown").split(/,\s*/).filter(Boolean);
const albumKey = (t: Track) => `${t.album ?? "Single"}|${artistsOf(t)[0] ?? ""}`;

/* ---------- rows ---------- */

export function TrackRow({ t, api, ids, index }: { t: Track; api: Api; ids: number[]; index?: number }) {
  const active = api.cur === t.id;
  return (
    <div className={`flex items-center gap-3 py-2 ${t.rating < 0 ? "opacity-45" : ""}`} style={{ contentVisibility: "auto", containIntrinsicSize: "0 64px" }}>
      <button onClick={() => api.play(ids, t.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left" aria-label={`Play ${t.title ?? ""}`}>
        {index != null && <span className="w-5 text-center text-sm text-[var(--dim3)] tabular-nums shrink-0">{active ? <Eq on={api.playing} /> : index}</span>}
        <span className="relative shrink-0">
          <Cover t={t} tq={api.tq} size={52} radius={8} />
          {active && index == null && <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/50 text-white"><Eq on={api.playing} /></span>}
        </span>
        <span className="min-w-0">
          <span className={`block text-[16px] leading-tight font-medium truncate ${active ? "underline decoration-2 underline-offset-4" : ""}`}>{t.title ?? "—"}</span>
          <span className="block text-[13px] text-[var(--dim)] truncate mt-0.5">{t.artist}{t.durationS ? ` · ${fmt(t.durationS)}` : ""}</span>
        </span>
      </button>
      {t.rating > 0 && <HeartIcon size={16} filled className="text-rose-500 shrink-0" />}
      <button onClick={() => api.menu(t)} className="p-2.5 -mr-1.5 text-[var(--dim)] hover:text-[var(--fg)] shrink-0" aria-label="More options"><MoreIcon size={22} /></button>
    </div>
  );
}

export function TrackList({ list, api, numbered }: { list: Track[]; api: Api; numbered?: boolean }) {
  const ids = useMemo(() => list.map((t) => t.id), [list]);
  if (api.loading) return <Skeleton />;
  if (list.length === 0) return <Empty text="Nothing here yet." />;
  return <div className="divide-y divide-[var(--bd0)]">{list.map((t, i) => <TrackRow key={t.id} t={t} api={api} ids={ids} index={numbered ? i + 1 : undefined} />)}</div>;
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
      for (const a of artistsOf(t)) artists.set(a, [...(artists.get(a) ?? []), t]);
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
      {c.recent.length > 0 && (<><SectionTitle>Jump back in</SectionTitle><Shelf>{c.recent.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} subtitle={t.artist ?? ""} onClick={() => api.play(c.recent.map((x) => x.id), t.id)} />)}</Shelf></>)}
      {c.top.length > 0 && (<><SectionTitle action={<button onClick={() => api.open({ kind: "top", key: "top", title: "Most played" })} className="text-sm text-[var(--dim)]">See all</button>}>Most played</SectionTitle><Shelf>{c.top.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} subtitle={`${t.playCount} plays`} onClick={() => api.play(c.top.map((x) => x.id), t.id)} />)}</Shelf></>)}
      {c.lists.length > 0 && (<><SectionTitle>Your playlists</SectionTitle><Shelf>{c.lists.map(({ p, tracks }) => <Card key={p.id} cover={<Mosaic tracks={tracks} tq={api.tq} size={144} radius={0} />} title={p.name} subtitle={`${tracks.length} songs`} onClick={() => api.open({ kind: "playlist", key: String(p.id), title: p.name })} />)}</Shelf></>)}
      {c.added.length > 0 && (<><SectionTitle>Recently added</SectionTitle><Shelf>{c.added.slice(0, 12).map((t) => <Card key={t.id} cover={<Cover t={t} tq={api.tq} size={144} radius={0} />} title={t.title ?? "—"} subtitle={t.artist ?? ""} onClick={() => api.play(c.added.map((x) => x.id), t.id)} />)}</Shelf></>)}
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
  const songs = useMemo(() => {
    const base = likedOnly ? c.liked : c.ready;
    const cmp: Record<Sort, (a: Track, b: Track) => number> = {
      recent: (a, b) => ts(b.readyAt ?? b.createdAt) - ts(a.readyAt ?? a.createdAt),
      az: (a, b) => (a.title ?? "").localeCompare(b.title ?? ""),
      plays: (a, b) => b.playCount - a.playCount,
      artist: (a, b) => (a.artist ?? "").localeCompare(b.artist ?? "") || (a.title ?? "").localeCompare(b.title ?? ""),
    };
    return [...base].sort(cmp[sort]);
  }, [c, sort, likedOnly]);
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
          <div className="flex items-center gap-2 mt-4">
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="bg-transparent text-[14px] font-semibold text-[var(--dim2)] outline-none">
              {SORTS.map(([k, l]) => <option key={k} value={k} className="text-black">{l}</option>)}
            </select>
            <button onClick={() => setLikedOnly((v) => !v)} className={`ml-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] font-semibold ${likedOnly ? "bg-rose-500/20 text-rose-500" : "bg-[var(--s1)] text-[var(--dim2)]"}`}><HeartIcon size={14} filled={likedOnly} /> Liked</button>
            <span className="flex-1" />
            <button onClick={() => api.play(songs.map((t) => t.id), undefined, true)} className="p-2 text-[var(--dim2)]" aria-label="Shuffle"><ShuffleIcon size={22} /></button>
            <button onClick={() => setGrid((g) => !g)} className="p-2 text-[var(--dim2)]" aria-label={grid ? "List view" : "Grid view"}>{grid ? <ListIcon size={22} /> : <GridIcon size={22} />}</button>
          </div>
          {grid ? (
            <div className="grid grid-cols-2 gap-4 mt-3">
              {songs.map((t) => (
                <button key={t.id} onClick={() => api.play(songs.map((x) => x.id), t.id)} className="text-left active:scale-[.97] transition" style={{ contentVisibility: "auto", containIntrinsicSize: "0 200px" }}>
                  <Cover t={t} tq={api.tq} size="100%" radius={12} className="aspect-square shadow-lg" />
                  <div className="mt-2 text-[15px] font-semibold truncate">{t.title}</div>
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
              <span className="w-14 h-14 rounded-full overflow-hidden shrink-0 block"><Cover t={list[0]!} tq={api.tq} size="100%" radius={0} /></span>
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
              <Cover t={list[0]!} tq={api.tq} size="100%" radius={12} className="aspect-square shadow-lg" />
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
      case "playlist": return c.lists.find((l) => String(l.p.id) === page.key)?.tracks ?? [];
      case "liked": return c.liked;
      case "recent": return c.recent;
      case "top": return c.top;
    }
  }, [page, c]);
  const ids = list.map((t) => t.id);
  const sub = page.kind === "artist" ? "Artist" : page.kind === "album" ? `Album · ${list[0] ? artistsOf(list[0])[0] : ""}` : "Playlist";
  return (
    <div>
      <div className="flex flex-col items-center text-center pt-2">
        <div className={`w-52 h-52 overflow-hidden shadow-2xl ${page.kind === "artist" ? "rounded-full" : "rounded-2xl"}`}>
          {page.kind === "liked" ? <span className="grid place-items-center w-full h-full bg-gradient-to-br from-rose-500 to-fuchsia-700 text-white"><HeartIcon size={64} filled /></span>
            : page.kind === "playlist" || page.kind === "top" || page.kind === "recent" ? <Mosaic tracks={list} tq={api.tq} size="100%" radius={0} />
            : list[0] ? <Cover t={list[0]} tq={api.tq} size="100%" radius={0} /> : null}
        </div>
        <h2 className="text-[28px] font-extrabold tracking-tight mt-5 leading-tight">{page.title}</h2>
        <div className="text-[14px] text-[var(--dim)] mt-1">{sub} · {list.length} {list.length === 1 ? "song" : "songs"}</div>
        <div className="flex items-center gap-3 mt-5">
          <PlayAllButton onClick={() => list[0] && api.play(ids, ids[0])} />
          <button onClick={() => api.play(ids, undefined, true)} className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[var(--s2)] font-semibold text-[15px] active:scale-95 transition"><ShuffleIcon size={18} /> Shuffle</button>
          <button onClick={() => void shareText(page.title, [`${page.title} — ${list.length} songs`, "", ...list.slice(0, 50).flatMap((t) => [...trackShareLines(t), ""])])} className="w-11 h-11 grid place-items-center rounded-full bg-[var(--s2)] active:scale-95 transition" aria-label="Share"><ShareIcon size={18} /></button>
        </div>
      </div>
      <div className="mt-6"><TrackList list={list} api={api} numbered={page.kind === "album"} /></div>
    </div>
  );
}

/* ---------- Search ---------- */

export function SearchView({ api, c }: { api: Api; c: Collections }) {
  const [q, setQ] = useState("");
  const s = q.trim().toLowerCase();
  const songs = useMemo(() => (s ? c.ready.filter((t) => `${t.title ?? ""} ${t.artist ?? ""} ${t.album ?? ""}`.toLowerCase().includes(s)) : []), [c.ready, s]);
  const artists = useMemo(() => (s ? [...c.artists.entries()].filter(([n]) => n.toLowerCase().includes(s)).slice(0, 6) : []), [c.artists, s]);
  const albums = useMemo(() => (s ? [...c.albums.entries()].filter(([, l]) => (l[0]!.album ?? "").toLowerCase().includes(s)).slice(0, 6) : []), [c.albums, s]);
  return (
    <div>
      <div className="relative mt-4">
        <SearchIcon size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--dim)]" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Songs, artists, albums" className="w-full rounded-xl bg-[var(--s2)] pl-11 pr-4 py-3.5 text-[16px] outline-none placeholder:text-[var(--dim)]" />
      </div>
      {!s && <Empty text="Search your library." />}
      {s && songs.length === 0 && artists.length === 0 && albums.length === 0 && <Empty text={`No results for “${q}”.`} />}
      {artists.length > 0 && (<><SectionTitle>Artists</SectionTitle>{artists.map(([n, l]) => (
        <button key={n} onClick={() => api.open({ kind: "artist", key: n, title: n })} className="w-full flex items-center gap-3 py-2 text-left"><span className="w-12 h-12 rounded-full overflow-hidden block shrink-0"><Cover t={l[0]!} tq={api.tq} size="100%" radius={0} /></span><span className="flex-1 font-medium truncate">{n}</span><ChevronRightIcon size={18} className="text-[var(--dim3)]" /></button>))}</>)}
      {albums.length > 0 && (<><SectionTitle>Albums</SectionTitle>{albums.map(([k, l]) => (
        <button key={k} onClick={() => api.open({ kind: "album", key: k, title: l[0]!.album ?? "Singles" })} className="w-full flex items-center gap-3 py-2 text-left"><Cover t={l[0]!} tq={api.tq} size={48} radius={8} /><span className="flex-1 min-w-0"><span className="block font-medium truncate">{l[0]!.album ?? "Singles"}</span><span className="block text-[13px] text-[var(--dim)] truncate">{artistsOf(l[0]!)[0]}</span></span><ChevronRightIcon size={18} className="text-[var(--dim3)]" /></button>))}</>)}
      {songs.length > 0 && (<><SectionTitle>Songs</SectionTitle><TrackList list={songs.slice(0, 40)} api={api} /></>)}
    </div>
  );
}

export const PlayGlyph = PlayIcon;
