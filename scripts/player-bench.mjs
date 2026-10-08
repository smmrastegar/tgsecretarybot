#!/usr/bin/env node
// Lab benchmark of the private music player against a PRODUCTION server
// (`npm run build && npx next start -p 3112`) with a mocked 431-track library.
//   node scripts/player-bench.mjs            → prints one JSON line
//   node scripts/player-bench.mjs --append   → also appends a row to docs/PLAYER_BENCH_LOG.md
// Env: PORT (3112), CHROMIUM (/opt/pw-browsers/chromium).
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const sharp = require("sharp");
const PORT = process.env.PORT || "3112";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TOK = "x".repeat(43);
const N = 431;

// --- fixtures -----------------------------------------------------------
const cover = await sharp(crypto.randomBytes(640 * 640 * 3), { raw: { width: 640, height: 640, channels: 3 } }).blur(1.2).jpeg({ quality: 78 }).toBuffer();
function wav(seconds) {
  const sr = 22050, n = sr * seconds, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / sr, e = 0.5 + 0.5 * Math.sin(2 * Math.PI * 1.7 * t); const v = 0.35 * Math.sin(2 * Math.PI * 80 * t) * e + 0.2 * Math.sin(2 * Math.PI * 440 * t) + 0.12 * Math.sin(2 * Math.PI * 2200 * t) + 0.05 * (Math.random() - 0.5); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 20000), 44 + i * 2); }
  return buf;
}
const tone = wav(90);
const A = ["Martik", "Jack Savoretti", "Taraamoon", "Mohammad Fereidouni", "Enrique Iglesias", "Shadmehr", "Joe Dassin", "Chopin", "Johnny Cash", "Mehrad Hidden"];
const tracks = Array.from({ length: N }, (_, i) => ({ id: i + 1, spotifyId: "sp" + i, spotifyUrl: "https://open.spotify.com/track/abcdefghijklmnopqrstuv", title: `Song number ${i + 1} title`, artist: A[i % 10] + (i % 3 ? ", Feat " + A[(i + 3) % 10] : ""), album: "Album " + (i % 60), releaseDate: "2025-09-17", durationS: 90, hasCover: true, status: "ready", error: null, rating: i % 17 === 0 ? 1 : 0, playCount: i % 5, skipCount: i % 3 === 0 ? 1 : 0, lastPlayedAt: i < 12 ? new Date(Date.now() - i * 3600e3).toISOString() : null, mime: "audio/wav", readyAt: "2026-10-05 04:00:00+00", createdAt: "2026-10-05 03:59:00+00", listenSeconds: 400, sizeBytes: tone.length, spotifyDurationS: 90 }));
const playlists = Array.from({ length: 8 }, (_, k) => ({ id: k + 1, name: "Playlist " + (k + 1), trackIds: tracks.slice(k * 40, k * 40 + 50).map((t) => t.id) }));

// --- run ----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 412, height: 845 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: "dark", serviceWorkers: "block" });
let coverReq = 0, coverBytes = 0, jsBytes = 0, fontBytes = 0;
await ctx.route("**/api/music?*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ tracks, playlists }) }));
await ctx.route("**/api/music/cover/*", (r) => { coverReq++; const w = Number(new URL(r.request().url()).searchParams.get("w")); const body = w ? cover.subarray(0, Math.round(cover.length * (w / 640) ** 2) + 400) : cover; coverBytes += body.length; r.fulfill({ contentType: "image/jpeg", body }); });
await ctx.route("**/api/music/*/lyrics*", (r) => r.fulfill({ json: { found: false } }));
await ctx.route("**/api/music/version*", (r) => r.fulfill({ json: { build: "bench" } }));
await ctx.route("**/api/music/*/event*", (r) => r.fulfill({ json: { ok: true } }));
await ctx.route("**/api/music/stats*", (r) => r.fulfill({ json: { totals: { tracks: N, plays: 1, listenSeconds: 1, likes: 1, dislikes: 0, skips: 0 }, topTracks: [], topArtists: [], days: [], recent: [] } }));
await ctx.route("**/api/music/stream/*", (r) => {
  const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers()["range"] || "");
  if (m) { const a = Number(m[1]), b = m[2] ? Number(m[2]) : tone.length - 1; return r.fulfill({ status: 206, contentType: "audio/wav", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${tone.length}` }, body: tone.subarray(a, b + 1) }); }
  r.fulfill({ status: 200, contentType: "audio/wav", headers: { "Accept-Ranges": "bytes" }, body: tone });
});
const page = await ctx.newPage();
page.on("response", async (r) => { const u = r.url(), h = r.headers()["content-length"]; const n = h ? Number(h) : (await r.body().catch(() => Buffer.alloc(0))).length; if (u.includes("/_next/static/chunks") && u.endsWith(".js")) jsBytes += n; if (/\.woff2?$/.test(u)) fontBytes += n; });
await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
const cdp = await ctx.newCDPSession(page); await cdp.send("Performance.enable");
const snap = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
const busy = (a, b, s) => Math.round(((b.TaskDuration - a.TaskDuration) * 1000) / s);

const t0 = Date.now();
await page.goto(`http://127.0.0.1:${PORT}/player/${TOK}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector("text=Jump back in", { timeout: 30000 });
const homeMs = Date.now() - t0;
await page.waitForTimeout(1200);
const homeCoverKB = Math.round(coverBytes / 1024), homeCovers = coverReq;
const cls = +(await page.evaluate(() => window.__cls)).toFixed(3);
const fontReady = await page.evaluate(() => document.fonts.ready.then(() => [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family)));

await page.click("nav >> text=Library");
await page.waitForSelector("button[aria-label^='Play ']");
await page.waitForTimeout(600);
const domNodes = await page.evaluate(() => document.querySelectorAll("*").length);
const jank = await page.evaluate(async () => { let long = 0, last = performance.now(), worst = 0; const st = performance.now(); await new Promise((res) => { const tick = (n) => { const d = n - last; if (d > 50) long++; worst = Math.max(worst, d); last = n; window.scrollTo(0, Math.min(12000, (n - st) * 6)); n - st < 2000 ? requestAnimationFrame(tick) : res(); }; requestAnimationFrame(tick); }); return { long, worst: Math.round(worst) }; });
await page.evaluate(() => window.scrollTo(0, 0));
const tapMs = await page.evaluate(async () => { const a = document.querySelector("audio"), before = a.getAttribute("src"), b = document.querySelector("button[aria-label^='Play ']"), t = performance.now(); b.click(); return await new Promise((res) => { const i = setInterval(() => { if (a.getAttribute("src") !== before) { clearInterval(i); res(Math.round(performance.now() - t)); } }, 4); setTimeout(() => { clearInterval(i); res(-1); }, 3000); }); });
await page.waitForTimeout(800);
const l0 = await snap(); await page.waitForTimeout(5000); const l1 = await snap();
const listPlayBusy = busy(l0, l1, 5);

await page.click("button[aria-label='Open player']");
await page.waitForTimeout(1200);
const p0 = await snap(); await page.waitForTimeout(5000); const p1 = await snap();
const fullPlayBusy = busy(p0, p1, 5);
const geo = await page.evaluate(() => { const r = document.querySelector("[aria-label='Seek']").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
await page.touchscreen.tap(geo.x + geo.w * 0.5, geo.y + geo.h / 2); await page.waitForTimeout(400);
const seekFrac = await page.evaluate(() => { const a = document.querySelector("audio"); return a.duration ? +(a.currentTime / a.duration).toFixed(2) : null; });
await page.click("button[aria-label='Pause']"); await page.waitForTimeout(1500);
const q0 = await snap(); await page.waitForTimeout(4000); const q1 = await snap();
const fullPausedBusy = busy(q0, q1, 4);

const out = {
  date: new Date().toISOString().slice(0, 10), homeMs, homeCovers, homeCoverKB, jsKB: Math.round(jsBytes / 1024), fontKB: Math.round(fontBytes / 1024), cls, fontsLoaded: fontReady,
  domNodes, scrollLongFrames: jank.long, scrollWorstMs: jank.worst, tapToSrcMs: tapMs,
  cpuListPlayingMsPerSec: listPlayBusy, cpuFullPlayerPlayingMsPerSec: fullPlayBusy, cpuFullPlayerPausedMsPerSec: fullPausedBusy, seekHitPx: Math.round(geo.h), seekTapAtHalf: seekFrac,
};
console.log(JSON.stringify(out));
if (process.argv.includes("--append")) {
  const f = path.join(ROOT, "docs", "PLAYER_BENCH_LOG.md");
  const head = "# Player benchmark log\n\nOne row per day, produced by `scripts/player-bench.mjs` against a production build with a mocked 431-track library (412×845 mobile emulation). Lower is better except where noted.\n\n| Date | Home ms | Home cover KB | JS KB (decoded) | Font KB | CLS | List-play CPU ms/s | Full-player CPU ms/s (playing / paused) | Tap→audio ms | Scroll long frames | Seek hit px | Seek tap@50% (ideal 0.5) |\n|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  const row = `| ${out.date} | ${out.homeMs} | ${out.homeCoverKB} | ${out.jsKB} | ${out.fontKB} | ${out.cls} | ${out.cpuListPlayingMsPerSec} | ${out.cpuFullPlayerPlayingMsPerSec} / ${out.cpuFullPlayerPausedMsPerSec} | ${out.tapToSrcMs} | ${out.scrollLongFrames} | ${out.seekHitPx} | ${out.seekTapAtHalf} |\n`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, head);
  fs.appendFileSync(f, row);
}
await browser.close();
