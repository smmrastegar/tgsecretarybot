// Regression test for "the next song does not start while the screen is locked".
// (Playwright is not a project dependency: run it from a folder where `playwright` is installed, e.g. copy the file there.)
// Runs the player in Chromium against mocked APIs (3 short tones, repeat-all) with React's scheduler STALLED, as it is in a
// hidden WebView: songs must still hand over by themselves. Needs `next dev -p 3111` and Playwright's Chromium.
//   node scripts/player-chain-test.mjs
import { chromium } from "playwright";

const wav = (freq) => {
  const rate = 8000, n = rate * 3, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * freq * i) / rate)), 44 + i * 2);
  return buf;
};
const tones = { 1: wav(440), 2: wav(550), 3: wav(660) };
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"] });
const ctx = await browser.newContext({ viewport: { width: 380, height: 800 }, serviceWorkers: "block" });
const T = (i) => ({ id: i, title: `Tone ${i}`, artist: "Test", album: "Single", releaseDate: null, durationS: 3, hasCover: false, status: "ready", rating: 0, playCount: 0, skipCount: 0, lastPlayedAt: null, mime: "audio/wav", readyAt: "2026-10-05 04:00:00+00", createdAt: "2026-10-05 03:59:00+00", listenSeconds: 0, sizeBytes: tones[1].length, sources: [] });
await ctx.route("**/api/music?*", (r) => r.fulfill({ json: { canLike: false, tracks: [T(1), T(2), T(3)], playlists: [], accounts: [] } }));
await ctx.route("**/api/music/vibes*", (r) => r.fulfill({ json: { vibes: [], tracks: {}, progress: { analyzed: 0, ready: 0 }, canCreate: false } }));
await ctx.route("**/api/music/stream/*", (r) => r.fulfill({ status: 200, contentType: "audio/wav", headers: { "Accept-Ranges": "none" }, body: tones[r.request().url().match(/stream\/(\d+)/)[1]] }));
await ctx.route("**/api/music/*/event*", (r) => r.fulfill({ json: { ok: true } }));
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:3111/player/" + "c".repeat(43), { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(3000);
await page.click("nav >> text=Library"); await page.waitForTimeout(500);
await page.locator("button[aria-label^='Play Tone 1']").first().click(); await page.waitForTimeout(800);
await page.click("button[aria-label='Open player']"); await page.waitForTimeout(500);
await page.click("button[aria-label^='Repeat']"); await page.waitForTimeout(200);
await page.evaluate(() => { window.__plays = 0; document.querySelector("audio").addEventListener("playing", () => { window.__plays++; }); });
await page.evaluate(() => { MessagePort.prototype.postMessage = function () {}; }); // React can no longer schedule work
await page.waitForTimeout(11000); // three hand-overs of 3-second songs
const plays = await page.evaluate(() => window.__plays);
await browser.close();
if (plays >= 3) console.log(`OK: ${plays} hand-overs with React stalled`);
else { console.error(`FAIL: only ${plays} hand-overs`); process.exit(1); }
