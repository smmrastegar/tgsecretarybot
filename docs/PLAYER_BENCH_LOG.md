# Player benchmark log

One row per day, produced by `scripts/player-bench.mjs` against a production build with a mocked 431-track library (412×845 mobile emulation). Lower is better except where noted.

| Date | Home ms | Home cover KB | JS KB (decoded) | Font KB | CLS | List-play CPU ms/s | Full-player CPU ms/s (playing / paused) | Tap→audio ms | Scroll long frames | Seek hit px | Seek tap@50% (ideal 0.5) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | 335 | 392 | 418 | 47 | 0 | 187 | 228 / 1 | 38 | 0 | 44 | 0.5 |
| 2026-10-23 | 326 | 391 | 498 | 47 | 0 | 221 | 267 / 0 | 32 | 0 | 56 | 0.5 |
| 2026-10-23 | 336 | 392 | 499 | 47 | 0 | 176 | 205 / 0 | 33 | 0 | 56 | 0.5 |

Notes
- 2026-10-23 (second row): rarely-opened sheets moved to `components/music/app/SheetsMore.tsx` (lazy chunk, warmed at idle). The "JS KB" column counts every script the session loads (the lazy chunk too), so it stays ≈ the same; the **player page chunk fell from 138.9 KB to 115.9 KB (−17 %)** — that is what blocks the first paint. List/full-player CPU in this run were lower than the first 23 Oct row, but run-to-run noise is ±10 %.
| 2026-10-30 | 424 | 391 | 518 | 47 | 0 | 36 | 43 / 0 | 43 | 0 | 56 | 0.5 |
- 2026-10-30: the equaliser bars animate `transform` instead of `height` (no layout per frame), the Web Audio spectrum is off by default on touch devices and uses `latencyHint: "playback"`. Main-thread busy time while a song plays (CDP profile, 8 s, mocked 431-song library): list view 122 → 43 ms/s, full player 193 → 46 ms/s.
