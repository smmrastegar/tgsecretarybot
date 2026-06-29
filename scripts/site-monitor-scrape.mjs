// External browser scraper for JS-SPA site monitors.
// Runs in GitHub Actions (which has a real Chromium via Playwright),
// logs into the configured site like a human, opens the target page,
// waits for the SPA to render, grabs the visible text, and POSTs it to
// the app's /api/site-monitors/ingest endpoint for AI analysis.
//
// Env:
//   SITE_LOGIN_URL, SITE_CHECK_URL, SITE_USER, SITE_PASS
//   INGEST_URL   (e.g. https://tgsecretarybot.vercel.app/api/site-monitors/ingest)
//   INGEST_SECRET
//   MONITOR_NAME (matches site_monitors.name)
import { chromium } from "playwright";

const {
  SITE_LOGIN_URL, SITE_CHECK_URL, SITE_USER, SITE_PASS,
  INGEST_URL, INGEST_SECRET, MONITOR_NAME = "MGH Report",
} = process.env;

function need(v, n) { if (!v) { console.error(`missing env ${n}`); process.exit(1); } }
need(SITE_LOGIN_URL, "SITE_LOGIN_URL"); need(SITE_CHECK_URL, "SITE_CHECK_URL");
need(INGEST_URL, "INGEST_URL"); need(INGEST_SECRET, "INGEST_SECRET");

const LOADING_MARKERS = [
  "Checking sign-in status", "اتصال برقرار نشد", "در حال اتصال",
  "نشست توسط سرور متوقف", "ادامه نشست ممکن نشد", "Loading", "در حال بارگذاری",
];

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await ctx.newPage();
let status = "ok", error = null, text = "";
try {
  // 1) Login
  if (SITE_USER) {
    await page.goto(SITE_LOGIN_URL, { waitUntil: "networkidle", timeout: 45000 });
    // Find username + password fields generically.
    const userSel = [
      'input[name="username"]','input[name="user"]','input[name="email"]',
      'input[type="email"]','input[type="text"]:not([type="hidden"])',
    ];
    const passSel = ['input[type="password"]','input[name="password"]','input[name="pass"]'];
    let userBox = null, passBox = null;
    for (const s of userSel) { const el = page.locator(s).first(); if (await el.count()) { userBox = el; break; } }
    for (const s of passSel) { const el = page.locator(s).first(); if (await el.count()) { passBox = el; break; } }
    if (!userBox || !passBox) throw new Error("login fields not found on page");
    await userBox.fill(SITE_USER);
    await passBox.fill(SITE_PASS ?? "");
    // Submit: click a submit button if present, else press Enter.
    const btn = page.locator('button[type="submit"], input[type="submit"], button:has-text("ورود"), button:has-text("Login"), button:has-text("Sign in")').first();
    if (await btn.count()) await btn.click().catch(() => {});
    else await passBox.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }
  // 2) Open the target page and wait for the SPA to render real content.
  await page.goto(SITE_CHECK_URL, { waitUntil: "networkidle", timeout: 60000 });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    text = (await page.innerText("body").catch(() => "")) || "";
    const stillLoading = LOADING_MARKERS.some((m) => text.includes(m));
    if (text.trim().length > 40 && !stillLoading) break;
    await page.waitForTimeout(2000);
  }
  text = (await page.innerText("body").catch(() => "")) || text;
} catch (e) {
  status = "error"; error = String(e?.message ?? e);
} finally {
  await browser.close().catch(() => {});
}

console.log(`[scrape] status=${status} textLen=${text.length}${error ? " error=" + error : ""}`);

// 3) Ship to the app for AI analysis + notes_inbox.
const res = await fetch(INGEST_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${INGEST_SECRET}` },
  body: JSON.stringify({ name: MONITOR_NAME, text: error ? `[scrape error] ${error}` : text }),
});
const bodyText = await res.text().catch(() => "");
console.log(`[ingest] HTTP ${res.status} ${bodyText.slice(0, 300)}`);
if (!res.ok) process.exit(1);
