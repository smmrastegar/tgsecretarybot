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
