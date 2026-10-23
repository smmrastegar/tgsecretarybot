"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRightIcon, CloseIcon, DownloadIcon, HeartIcon, PlayIcon, SearchIcon } from "../Icons";
import { Cover, Mosaic, SectionTitle, Shelf, type Track } from "./shared";
import { TitleLine } from "./SourceMarks";
import { SONG_SETS } from "./sets";
import { artistsOf, TrackList, type Api, type Collections } from "./Views";

// Search, Spotify style: a big white search box; with nothing typed, "Browse all" colour tiles (your collections, vibes, genres,
// top artists); once you type, ranked results — a top result, songs, artists, albums, playlists — with filter chips.

/** lower-case, no accents, Arabic yeh/kaf and Persian digits unified, so Persian titles match however they were typed */
const norm = (v: string) => v.normalize("NFKD").replace(/[̀-ًͯ-ٟـ]/g, "").replace(/ي/g, "ی").replace(/ك/g, "ک")
  .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).toLowerCase();

const TILE_COLORS = ["#e8115b", "#1e8f6a", "#8d67ab", "#477d95", "#e13300", "#7358ff", "#dc148c", "#509bf5", "#af2896", "#148a08", "#bc5900", "#1e3264", "#9a4f2a", "#2d46b9"];
const tileColor = (key: string) => TILE_COLORS[[...key].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % TILE_COLORS.length]!;
const RECENT_KEY = "player.recentSearches";
type Filter = "all" | "songs" | "artists" | "albums" | "playlists";

function Tile({ tq, title, sub, color, art, onClick, children }: { tq: string; title: string; sub?: string; color: string; art?: Track | Track[]; onClick: () => void; children?: React.ReactNode }) {
  return (
    <button onClick={onClick} className="relative h-[92px] rounded-lg overflow-hidden text-left p-3 active:scale-[.97] transition" style={{ background: color }}>
      <span className={`block font-bold leading-tight text-white pr-14 break-words [text-wrap:balance] line-clamp-3 ${title.length > 14 ? "text-[15px]" : "text-[17px]"}`}>{title}</span>
      {sub && <span className="block text-[11px] text-white/80 mt-1">{sub}</span>}
      <span className="absolute -right-3 -bottom-2 w-[68px] h-[68px] rotate-[25deg] rounded-md overflow-hidden shadow-[0_6px_16px_rgba(0,0,0,.4)] grid place-items-center bg-black/25 text-white">
        {Array.isArray(art) ? <Mosaic tracks={art} tq={tq} size="100%" radius={0} /> : art ? <Cover t={art} tq={tq} size="100%" radius={0} res={128} /> : children}
      </span>
    </button>
  );
}
function SearchViewImpl({ api, c }: { api: Api; c: Collections }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { try { const r = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]") as unknown; if (Array.isArray(r)) setRecent(r.map(String).slice(0, 8)); } catch { /* none */ } }, []);
  const remember = (term: string) => {
    const t = term.trim(); if (t.length < 2) return;
    const next = [t, ...recent.filter((x) => norm(x) !== norm(t))].slice(0, 8);
    setRecent(next); try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  };
  const forget = () => { setRecent([]); try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ } };

  const tokens = useMemo(() => norm(q).split(/\s+/).filter(Boolean), [q]);
  const searching = tokens.length > 0;

  // Songs: every word must appear somewhere (title, artist, album, genre); better matches first.
  const songs = useMemo(() => {
    if (!searching) return [] as Track[];
    const out: Array<{ t: Track; score: number }> = [];
    for (const t of c.ready) {
      const title = norm(t.title ?? ""), artist = norm(`${t.artist ?? ""} ${t.uploadedBy ?? t.uploader ?? ""}`), album = norm(t.album ?? "");
      const genres = norm((api.desc[t.id]?.genres ?? []).join(" "));
      let score = 0, ok = true;
      for (const w of tokens) {
        let s = 0;
        if (title.startsWith(w)) s = 4; else if (title.split(/\s+/).some((x) => x.startsWith(w))) s = 3; else if (title.includes(w)) s = 2;
        else if (artist.split(/[\s,]+/).some((x) => x.startsWith(w))) s = 2.5; else if (artist.includes(w)) s = 1.5;
        else if (album.includes(w)) s = 1; else if (genres.includes(w)) s = 0.5;
        if (s === 0) { ok = false; break; }
        score += s;
      }
      if (ok) out.push({ t, score: score + Math.min(t.playCount, 20) * 0.02 + (t.rating > 0 ? 0.3 : 0) - (t.rating < 0 ? 5 : 0) });
    }
    return out.sort((a, b) => b.score - a.score).map((x) => x.t);
  }, [c.ready, tokens, searching, api.desc]);
  const matchName = (name: string) => { const n = norm(name); return tokens.every((w) => n.includes(w)); };
  const artists = useMemo(() => (searching ? [...c.artists.entries()].filter(([n]) => matchName(n)).sort((a, b) => b[1].length - a[1].length) : []), [c.artists, tokens]); // eslint-disable-line react-hooks/exhaustive-deps -- matchName only reads tokens
  const albums = useMemo(() => (searching ? [...c.albums.entries()].filter(([, l]) => matchName(l[0]!.album ?? "")) : []), [c.albums, tokens]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useMemo(() => (searching ? c.lists.filter(({ p }) => matchName(p.name)) : []), [c.lists, tokens]); // eslint-disable-line react-hooks/exhaustive-deps

  // The single best answer: a name that starts with what you typed beats a loose song match.
  const top = useMemo(() => {
    if (!searching) return null;
    const first = norm(q).trim();
    const a = artists.find(([n]) => norm(n).startsWith(first)) ?? artists.find(([n]) => norm(n) === first);
    if (a) return { kind: c.credited.has(a[0]) ? "artist" as const : "uploader" as const, name: a[0], tracks: a[1] };
    const al = albums.find(([, l]) => norm(l[0]!.album ?? "").startsWith(first));
    if (al) return { kind: "album" as const, name: al[1][0]!.album ?? "Singles", key: al[0], tracks: al[1] };
    if (songs[0]) return { kind: "song" as const, name: songs[0].title ?? "—", track: songs[0] };
    if (artists[0]) return { kind: c.credited.has(artists[0][0]) ? "artist" as const : "uploader" as const, name: artists[0][0], tracks: artists[0][1] };
    return null;
  }, [searching, q, artists, albums, songs, c.credited]);

  // Browse tiles (nothing typed)
  const offlineCount = useMemo(() => c.ready.filter((t) => api.offline.has(t.id)).length, [c.ready, api.offline]);
  const genres = useMemo(() => {
    const n = new Map<string, number>();
    for (const t of c.ready) for (const g of api.desc[t.id]?.genres ?? []) n.set(g, (n.get(g) ?? 0) + 1);
    return [...n.entries()].filter(([g, k]) => g.length <= 16 && k >= 4).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [c.ready, api.desc]);
  // Short, plain names only: moods, tempo and decades that have enough songs (the auto-named "vibes" live on the Home tab).
  const sets = useMemo(() => SONG_SETS.map((set) => ({ set, list: c.ready.filter((t) => set.test(t, api.desc[t.id])) })).filter((x) => x.list.length >= 4), [c.ready, api.desc]);
  const topArtists = useMemo(() => [...c.artists.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 10), [c.artists]);

  const chip = (k: Filter, label: string, n: number) => (n > 0 || k === "all") && (
    <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`shrink-0 px-4 py-1.5 rounded-full text-[14px] font-semibold ${filter === k ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--s1)] text-[var(--dim2)]"}`}>{label}</button>
  );
  const show = (k: Filter) => filter === "all" || filter === k;
  const artistRow = ([n, l]: [string, Track[]]) => (
    <button key={n} onClick={() => { remember(q); api.open({ kind: c.credited.has(n) ? "artist" : "uploader", key: n, title: n }); }} className="w-full flex items-center gap-3 py-2 text-left">
      <span className="w-14 h-14 rounded-full overflow-hidden block shrink-0"><Cover t={l[0]!} tq={api.tq} size="100%" radius={0} res={128} /></span>
      <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{n}</span><span className="block text-[13px] text-[var(--dim)]">{c.credited.has(n) ? "Artist" : "Uploader"} · {l.length} {l.length === 1 ? "song" : "songs"}</span></span>
      <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
    </button>
  );
  const albumRow = ([k, l]: [string, Track[]]) => (
    <button key={k} onClick={() => { remember(q); api.open({ kind: "album", key: k, title: l[0]!.album ?? "Singles" }); }} className="w-full flex items-center gap-3 py-2 text-left">
      <Cover t={l[0]!} tq={api.tq} size={56} radius={6} />
      <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{l[0]!.album ?? "Singles"}</span><span className="block text-[13px] text-[var(--dim)] truncate">Album · {artistsOf(l[0]!)[0]}</span></span>
      <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
    </button>
  );

  return (
    <div>
      <div className="relative mt-2">
        <SearchIcon size={22} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--bg)] opacity-70" />
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setFilter("all"); }} onKeyDown={(e) => { if (e.key === "Enter") { remember(q); e.currentTarget.blur(); } }}
          enterKeyHint="search" type="search" autoComplete="off" autoCorrect="off" spellCheck={false} placeholder="What do you want to listen to?" aria-label="Search your library"
          className="w-full rounded-md bg-[var(--fg)] text-[var(--bg)] placeholder:text-[var(--bg)]/60 pl-11 pr-11 py-3.5 text-[16px] font-medium outline-none [&::-webkit-search-cancel-button]:hidden" />
        {q && <button onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Clear search" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-[var(--bg)] opacity-70"><CloseIcon size={20} /></button>}
      </div>

      {!searching && (
        <>
          {recent.length > 0 && (
            <div className="mt-4">
              <div className="flex items-baseline justify-between"><span className="text-[15px] font-bold">Recent searches</span><button onClick={forget} className="text-[13px] text-[var(--dim)] font-semibold">Clear</button></div>
              <div className="mt-2 flex flex-wrap gap-2">{recent.map((r) => <button key={r} onClick={() => setQ(r)} className="px-3.5 py-1.5 rounded-full bg-[var(--s1)] text-[14px] text-[var(--dim2)]">{r}</button>)}</div>
            </div>
          )}
          <SectionTitle>Browse all</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Tile tq={api.tq} title="Liked Songs" sub={`${c.liked.length} songs`} color="#7358ff" onClick={() => api.open({ kind: "liked", key: "liked", title: "Liked Songs" })}><HeartIcon size={30} filled /></Tile>
            {offlineCount > 0 && <Tile tq={api.tq} title="Downloaded" sub={`${offlineCount} songs`} color="#148a08" onClick={() => api.open({ kind: "offline", key: "offline", title: "Downloaded" })}><DownloadIcon size={30} /></Tile>}
            {c.recent.length > 0 && <Tile tq={api.tq} title="Played recently" color="#477d95" art={c.recent.slice(0, 4)} onClick={() => api.open({ kind: "recent", key: "recent", title: "Played recently" })} />}
            {c.top.length > 0 && <Tile tq={api.tq} title="Most played" color="#e13300" art={c.top.slice(0, 4)} onClick={() => api.open({ kind: "top", key: "top", title: "Most played" })} />}
            {c.lists.map(({ p, tracks }) => <Tile tq={api.tq} key={`p${p.id}`} title={p.name} sub={`${tracks.length} songs`} color={tileColor(p.name)} art={tracks.slice(0, 4)} onClick={() => api.open({ kind: "playlist", key: String(p.id), title: p.name })} />)}
          </div>
          {sets.length > 0 && (<>
            <SectionTitle>Moods &amp; more</SectionTitle>
            <div className="grid grid-cols-2 gap-3">{sets.map(({ set, list }) => <Tile key={set.key} tq={api.tq} title={set.label} sub={`${list.length} songs`} color={tileColor(set.key)} art={list.slice(0, 4)} onClick={() => api.open({ kind: "set", key: set.key, title: set.label })} />)}</div>
          </>)}
          {genres.length > 0 && (<>
            <SectionTitle>Genres</SectionTitle>
            <div className="grid grid-cols-2 gap-3">{genres.map(([g, n]) => <Tile tq={api.tq} key={g} title={g.charAt(0).toUpperCase() + g.slice(1)} sub={`${n} songs`} color={tileColor(g)} art={c.ready.filter((t) => api.desc[t.id]?.genres.includes(g)).slice(0, 1)[0]} onClick={() => setQ(g)} />)}</div>
          </>)}
          {topArtists.length > 0 && (<>
            <SectionTitle>Your artists</SectionTitle>
            <Shelf>{topArtists.map(([n, l]) => (
              <button key={n} onClick={() => api.open({ kind: "artist", key: n, title: n })} className="w-28 shrink-0 text-center snap-start active:scale-[.97] transition">
                <span className="block w-28 h-28 rounded-full overflow-hidden shadow-lg"><Cover t={l[0]!} tq={api.tq} size="100%" radius={0} res={128} /></span>
                <span className="block mt-2 text-[14px] font-semibold truncate">{n}</span>
              </button>))}</Shelf>
          </>)}
          {c.ready.length === 0 && !api.loading && <div className="py-14 text-center text-sm text-[var(--dim)]">Your library is empty.</div>}
        </>
      )}

      {searching && (
        <>
          <div className="mt-3 flex gap-2 overflow-x-auto -mx-4 px-4 [scrollbar-width:none]">
            {chip("all", "All", 1)}{chip("songs", "Songs", songs.length)}{chip("artists", "Artists", artists.length)}{chip("albums", "Albums", albums.length)}{chip("playlists", "Playlists", lists.length)}
          </div>
          {songs.length + artists.length + albums.length + lists.length === 0 && (
            <div className="py-14 text-center">
              <div className="text-[17px] font-bold">No results for “{q.trim()}”</div>
              <div className="mt-1 text-[14px] text-[var(--dim)]">Check the spelling, or try fewer words.</div>
            </div>
          )}

          {filter === "all" && top && (
            <>
              <SectionTitle>Top result</SectionTitle>
              <div className="rounded-xl bg-[var(--s1)] p-4 active:scale-[.99] transition">
                {top.kind === "song" ? (
                  <button onClick={() => { remember(q); api.play(songs.map((t) => t.id), top.track.id); }} className="flex items-center gap-4 w-full text-left">
                    <Cover t={top.track} tq={api.tq} size={96} radius={8} />
                    <span className="min-w-0 flex-1"><span className="block text-[22px] font-extrabold leading-tight"><TitleLine title={top.name} ids={top.track.sources} className="text-[22px] font-extrabold" /></span><span className="block mt-1 text-[14px] text-[var(--dim)] truncate">Song · {top.track.artist}</span></span>
                    <span className="w-12 h-12 shrink-0 rounded-full grid place-items-center bg-[rgb(var(--ac))] text-[var(--acfg)]"><PlayIcon size={22} /></span>
                  </button>
                ) : (
                  <button onClick={() => { remember(q); api.open(top.kind === "album" ? { kind: "album", key: top.key, title: top.name } : { kind: top.kind, key: top.name, title: top.name }); }} className="flex items-center gap-4 w-full text-left">
                    <span className={`w-24 h-24 overflow-hidden shrink-0 block shadow-lg ${top.kind === "album" ? "rounded-lg" : "rounded-full"}`}><Cover t={top.tracks[0]!} tq={api.tq} size="100%" radius={0} /></span>
                    <span className="min-w-0 flex-1"><span className="block text-[22px] font-extrabold leading-tight break-words">{top.name}</span><span className="block mt-1 text-[14px] text-[var(--dim)]">{top.kind === "artist" ? "Artist" : top.kind === "uploader" ? "Uploader" : "Album"} · {top.tracks.length} {top.tracks.length === 1 ? "song" : "songs"}</span></span>
                    <ChevronRightIcon size={20} className="text-[var(--dim3)]" />
                  </button>
                )}
              </div>
            </>
          )}

          {show("songs") && songs.length > 0 && (<>
            <SectionTitle action={filter === "all" && songs.length > 5 ? <button onClick={() => setFilter("songs")} className="text-sm text-[var(--dim)] font-semibold">Show all {songs.length}</button> : undefined}>Songs</SectionTitle>
            <TrackList list={filter === "all" ? songs.slice(0, 5) : songs.slice(0, 100)} api={api} />
            {filter === "songs" && songs.length > 100 && <div className="py-3 text-center text-[13px] text-[var(--dim)]">Showing the best 100 of {songs.length}. Add a word to narrow it down.</div>}
          </>)}
          {show("artists") && artists.length > 0 && (<>
            <SectionTitle action={filter === "all" && artists.length > 3 ? <button onClick={() => setFilter("artists")} className="text-sm text-[var(--dim)] font-semibold">Show all {artists.length}</button> : undefined}>Artists</SectionTitle>
            {(filter === "all" ? artists.slice(0, 3) : artists).map(artistRow)}
          </>)}
          {show("albums") && albums.length > 0 && (<>
            <SectionTitle action={filter === "all" && albums.length > 3 ? <button onClick={() => setFilter("albums")} className="text-sm text-[var(--dim)] font-semibold">Show all {albums.length}</button> : undefined}>Albums</SectionTitle>
            {(filter === "all" ? albums.slice(0, 3) : albums).map(albumRow)}
          </>)}
          {show("playlists") && lists.length > 0 && (<>
            <SectionTitle>Playlists</SectionTitle>
            {lists.map(({ p, tracks }) => (
              <button key={p.id} onClick={() => { remember(q); api.open({ kind: "playlist", key: String(p.id), title: p.name }); }} className="w-full flex items-center gap-3 py-2 text-left">
                <Mosaic tracks={tracks} tq={api.tq} size={56} radius={6} />
                <span className="min-w-0 flex-1"><span className="block text-[16px] font-medium truncate">{p.name}</span><span className="block text-[13px] text-[var(--dim)]">Playlist · {tracks.length} songs</span></span>
                <ChevronRightIcon size={18} className="text-[var(--dim3)]" />
              </button>
            ))}
          </>)}
        </>
      )}
    </div>
  );
}

export const SearchView = memo(SearchViewImpl);
