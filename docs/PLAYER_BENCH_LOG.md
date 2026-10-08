# Player benchmark log

One row per day, produced by `scripts/player-bench.mjs` against a production build with a mocked 431-track library (412×845 mobile emulation). Lower is better except where noted.

| Date | Home ms | Home cover KB | JS KB (decoded) | Font KB | CLS | List-play CPU ms/s | Full-player CPU ms/s (playing / paused) | Tap→audio ms | Scroll long frames | Seek hit px | Seek tap@50% (ideal 0.5) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-08 | 335 | 392 | 418 | 47 | 0 | 187 | 228 / 1 | 38 | 0 | 44 | 0.5 |
