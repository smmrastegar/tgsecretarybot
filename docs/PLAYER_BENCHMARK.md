# Player benchmark — UI/UX and features

Method: a feature/UX checklist built from the publicly known behaviour of
the reference apps — **Spotify, Apple Music, YouTube Music, Tidal,
Plexamp** (the self-hosted one is the closest peer). It is a
checklist-based comparison from product knowledge, not a live
side-by-side test. Each line scores the previous private player (**Before**)
and the rebuilt one (**After**): ✅ done · 🟡 partial · ❌ missing.

| # | Area | Reference behaviour | Before | After |
|---|------|--------------------|:--:|:--:|
| 1 | Navigation | Persistent bottom tab bar (Home / Search / Library), content scrolls under a large title | ❌ top pills | ✅ |
| 2 | Home | "Jump back in", mixes, liked-songs shortcut, recently played / added shelves | ❌ | ✅ |
| 3 | Library structure | Songs / Artists / Albums / Playlists, sort, list↔grid | 🟡 songs + playlist chips | ✅ |
| 4 | Drill-down pages | Artist, album and playlist pages with Play / Shuffle header | ❌ | ✅ |
| 5 | Search | Dedicated tab, instant grouped results (songs, artists, albums) | 🟡 filter box | ✅ |
| 6 | Row design | Flat rows, hairline dividers, now-playing indicator, secondary info, overflow menu | 🟡 boxed cards | ✅ |
| 7 | Track menu | Play next, add to queue, like, go to artist/album, details | ❌ | ✅ |
| 8 | Queue | View, play next / add to queue, remove, reorder, clear | ❌ read-only "up next" | ✅ |
| 9 | Mini player | Cover, title, play/pause, thin progress, tap to expand | 🟡 | ✅ |
| 10 | Full player | Big artwork, seek with times, transport, like, queue, swipe-down to close, swipe artwork to skip | 🟡 no queue / gestures | ✅ |
| 11 | Sleep timer | 5–60 min and "end of track" | ❌ | ✅ |
| 12 | Playback speed | 0.75× – 2× | ❌ | ✅ |
| 13 | Keyboard | Space, arrows, N/P, L | ❌ | ✅ |
| 14 | Lock-screen / OS controls | Media Session with artwork, seek | 🟡 no seek | ✅ |
| 15 | Smart mix | Personalised radio-style shuffle | ✅ | ✅ |
| 16 | Like / dislike | Heart + hide | ✅ | ✅ |
| 17 | Listening stats | Wrapped-style totals, top tracks/artists | ✅ | ✅ |
| 18 | Details per track | Metadata, plays, skips, live session | ✅ | ✅ |
| 19 | Large-library perf | Windowed lists, lazy images, skeletons | 🟡 no virtualisation | ✅ `content-visibility`, lazy images, skeletons |
| 20 | Mobile polish | Safe-area insets, tap targets ≥44 px, no layout jump | 🟡 | ✅ |
| 21 | Themes | Dark + light, follows OS | ✅ | ✅ |
| 22 | Gapless / crossfade | Reference apps have both | ❌ | ✅ Fade between tracks (3/6/10 s dip fade) + next-track preload; true overlap not possible with one `<audio>` |
| 23 | Lyrics | Reference apps have synced lyrics | ❌ | ✅ Synced lyrics via LRCLIB, cached, tap a line to seek |
| 24 | Offline | Downloads / PWA cache | ❌ | ✅ Save-for-offline per track (Cache API) + service worker for the shell |

Score = (✅ ×1 + 🟡 ×0.5) / 24 — **Before 38 %**, **After 88 %**.
Open items are listed as 22–24.

## Now Playing screen — measured benchmark

Reference: Spotify, Apple Music and YouTube Music mobile now-playing screens.
Rule shared by all three: **every primary control is visible without scrolling** on any phone, the artwork is the flexible element and shrinks to make room, and the OS owns volume.

Measured with Playwright (touch + mobile emulation, the page's real DOM): art height / play-button bottom / lowest action-button bottom, all in CSS px.

| Viewport | Before | Fits | After | Fits |
|---|---|---|---|---|
| 412 × 745 (Android Chrome, the reported screenshot) | 364 / 690 / 830 | ❌ 85 px off-screen | 374 / 657 / 729 | ✅ |
| 390 × 664 (iPhone Safari with bars) | 342 / 668 / 808 | ❌ play button off-screen | 293 / 576 / 648 | ✅ |
| 360 × 600 (small Android) | 312 / 638 / 778 | ❌ play button off-screen | 229 / 512 / 584 | ✅ |
| 375 × 520 (tiny) | — | ❌ | 149 / 432 / 504 | ✅ |

| # | Criterion (reference behaviour) | Before | After |
|---|---|---|---|
| 1 | All primary controls above the fold | ❌ | ✅ artwork flexes to the free height |
| 2 | Artwork ≤ ~50 % of viewport height | ⚠️ fixed 49–52 % | ✅ 29–50 %, adaptive |
| 3 | Volume slider hidden on touch devices | ❌ | ✅ (`pointer: coarse`), kept on desktop |
| 4 | Spectrum legible on light covers | ❌ white on cream | ✅ stronger scrim behind the bars |
| 5 | Title/artist hierarchy | ⚠️ 22/16 px | ✅ 20/15 px |
| 6 | Play button size | ⚠️ 72 px | ✅ 64 px |
| 7 | Secondary actions in one row | ✅ | ✅ more compact |
| 8 | Safe-area padding | ✅ | ✅ |

## Performance pass — measured (431-track library, mobile emulation, production build)

Data that drove it (listening log, 110 sessions): only 3 completed plays, 76 of 110 sessions ended before 15 s, and 28 of 29 sub-5-second skips happened on day one (the wrong-audio bug). So the audio path was fixed first; this pass targets the cost of the UI itself.

| Metric | Before | After | Change |
|---|---|---|---|
| Home screen cover bytes (41 images, mocked 640 px source) | 3,176 KB | 391 KB | −88 % (rows/tiles now fetch 128/320 px renditions, cached on disk) |
| CPU while a track plays (script + layout + style, per second) | 92 ms/s | 39 ms/s | −58 % (rows memoised; progress tick no longer re-renders lists) |
| Tap on a row → audio source set | 46 ms | 26 ms | −43 % |
| /player first-load JS | 125 kB | 122 kB | Stats + track details load on demand |
| Scroll 12 000 px (frames >50 ms) | 0 | 0 | already smooth (`content-visibility`) |
| DOM nodes, full 431-song list | 5,318 | 5,318 | unchanged (lazy rendering already in place) |

## Problem reports (new)
Small flag icon in the now-playing header and "Report a problem" in every track menu: tick-boxes (wrong song, wrong cover, wrong title/artist, bad quality, cuts off, won't play, glitches, wrong lyrics, other) plus free text. Playback context (position, duration, connection, audio error code, app build, viewport) is attached automatically. Reports land in `music_reports`, in the System Log, and in a "گزارش مشکل از پلیر" card on /music with *re-download & close* / *resolved*.

## Seek bar, spectrum, font, navigation — benchmark & changes (2026-10-08)

Reference: Spotify, Apple Music, YouTube Music (mobile now-playing).

### Seek bar
| Criterion | Before (native `<input range>`) | After (`SeekBar`) |
|---|---|---|
| Touch target ≥ 44 px | ❌ 40 px | ✅ 44 px |
| Track thickens while held, larger thumb | ❌ | ✅ 4 → 8 px, thumb ×1.45 |
| Time bubble above the thumb while dragging | ❌ | ✅ |
| Buffered segment | ❌ | ✅ |
| Seek commits on release (no stutter while dragging) | ❌ every `change` | ✅ |
| Tap at 50 % lands at 50 % | ❌ 0 % in lab (non-seekable mock) / unreliable | ✅ 0.50 |
| ARIA slider + keyboard (←/→, Shift = 30 s, Home/End) | ⚠️ native only | ✅ |

### Spectrum
| Criterion | Before | After |
|---|---|---|
| Frequency mapping | linear FFT bins (bass crammed in 2–3 bars) | ✅ 44 log-spaced bands, 50 Hz–14 kHz, mirrored, bass centred |
| Quiet/loud tracks fill the height | ❌ fixed gain | ✅ treble tilt + slow auto-gain |
| Peak caps with gravity | ❌ | ✅ |
| CPU while **paused** | 51 ms/s (loop never stopped) | **0 ms/s** (loop stops once settled; also while tab hidden / reduced motion) |
| Draw cost | gradient + path per bar, 60 fps | 1 gradient + 2 batched paths, ~38 fps |
| User control | ❌ | ✅ tap the strip to turn it off (remembered); default **off on iOS** because Web Audio routing can be suspended in the background there |

Verdict: a log-band mirrored analyser is the right choice for a cover overlay; Spotify/Apple don't show one at all, so it stays optional.

### Font
| Candidate | Size | Cross-device consistency | Tabular figures | Verdict |
|---|---|---|---|---|
| OS default (Roboto / SF / Segoe) | 0 KB | ❌ differs per phone, so spacing and centring differ | partly | previous |
| **Inter variable (latin subset), self-hosted** | 47 KB | ✅ identical everywhere | ✅ `tnum` | **chosen** |
Measured: CLS 0 (next/font size-matched fallback), font loaded from our own origin and cached by the service worker.

### Navigation & sheets
| Criterion | Before | After |
|---|---|---|
| Android Back closes the top layer (sheet → full player → drill-down page) instead of leaving | ❌ left the player | ✅ history-backed layer stack, verified end-to-end |
| Drag a sheet's handle/title down to dismiss | ❌ | ✅ (and no pull-to-refresh / page collapse) |
| Details sheet: hero text vertically centred against the cover | ❌ bottom-aligned, overflowed | ✅ |
| Stat tiles: content centred in equal-height tiles | ❌ uneven | ✅ |
| Icons: no inline-baseline offset | ❌ | ✅ `display:block` |

Daily lab numbers are appended to `docs/PLAYER_BENCH_LOG.md` by `scripts/player-bench.mjs --append`.
