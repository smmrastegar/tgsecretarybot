# Site Monitor — setup

Two modes:

- **🌐 HTTP** — the Vercel cron logs in (form POST) and fetches the page
  itself. Works for server-rendered sites. No extra setup.
- **🧭 Browser** — for JavaScript SPA sites (like mgh-report) that the
  cron can't render. A free **GitHub Action** runs a real Chromium,
  logs in, scrapes the text, and POSTs it to the app for AI analysis.

## Browser mode setup (for mgh-report)

### 1. Create the monitor in the dashboard
Settings → 🌐 Site Monitor → new monitor:
- Name: `MGH Report`  (must match the `MONITOR_NAME` secret below)
- Login URL: `https://mgh-report.obsolete.ir/`
- Check URL: `https://mgh-report.obsolete.ir/margin?run=1`
- User / Pass: the site credentials
- Mode: **🧭 مرورگر (browser)**
- notify_on: `nonempty` (notify whenever the page has a result) or
  `change` (only when it changes)

### 2. Add the ingest secret to Vercel
Vercel → Project → Settings → Environment Variables → redeploy:
```
SITE_MONITOR_INGEST_SECRET=URdP6yxMpldBKpVbgymxK8Q73m-i7rxs
```

### 3. Add GitHub repo Secrets
GitHub repo → Settings → Secrets and variables → Actions → New secret,
add each:

| Secret | Value |
|--------|-------|
| `SITE_LOGIN_URL` | `https://mgh-report.obsolete.ir/` |
| `SITE_CHECK_URL` | `https://mgh-report.obsolete.ir/margin?run=1` |
| `SITE_USER` | the site username |
| `SITE_PASS` | the site password |
| `INGEST_URL` | `https://tgsecretarybot.vercel.app/api/site-monitors/ingest` |
| `SITE_MONITOR_INGEST_SECRET` | **same value** as the Vercel env above |
| `MONITOR_NAME` | `MGH Report` |

### 4. Schedule
The workflow (`.github/workflows/site-monitor.yml`) runs at **09:30 &
11:30 UTC = 13:00 & 15:00 Tehran**, on Sat/Sun/Mon/Tue/Wed (skips
Thursday & Friday).

> ⚠️ GitHub only runs scheduled workflows from the **default branch**.
> Merge this branch into the repo's default branch (e.g. `main`) for
> the cron to fire. You can test immediately from any branch via the
> Actions tab → "Site Monitor" → **Run workflow**.

### How it works
GitHub Action → real browser logs in → opens /margin → waits for the
SPA to render → grabs text → POST /api/site-monitors/ingest → app runs
`analyzeSiteChange` (AI) → if there's a result, posts a card to the
**Note Inbox** channel.
