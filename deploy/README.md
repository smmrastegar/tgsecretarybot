# Self-hosting tgsecretarybot on the DB server (209.97.138.127)

Move the app off Vercel onto the same box that already runs Postgres.
This removes the serverless pain (function freezes, cold starts,
maxDuration) and makes every DB query a localhost round-trip.

**Repo:** `https://github.com/smmrastegar/tgsecretarybot`
**Branch:** `claude/telegram-secretary-bot-A0UsO`

## Prerequisites (do these first)

1. **DNS** — point a domain/subdomain's `A` record at `209.97.138.127`.
   Telegram's webhook needs valid HTTPS; Caddy gets the cert automatically.
2. **Firewall** — open ports **80** and **443** (`ufw allow 80,443/tcp`).
   Postgres (5432) should stay closed to the internet — the app now
   reaches it on `127.0.0.1`.

## Install (once)

```bash
# on the server, as root
mkdir -p /opt && cd /opt
# Private repo → clone over HTTPS with a GitHub token (or SSH if you
# have a deploy key). Replace <TOKEN> with a GitHub PAT that can read it.
git clone https://<TOKEN>@github.com/smmrastegar/tgsecretarybot.git tgsecretarybot
cd tgsecretarybot
git checkout claude/telegram-secretary-bot-A0UsO

# 1) create the env file and fill it from your Vercel env vars
cp deploy/.env.template .env
nano .env            # DATABASE_URL host → 127.0.0.1 ; NEXT_PUBLIC_APP_URL → your domain
chmod 600 .env

# 2) run the bootstrap (installs Node+Caddy, builds, wires systemd+cron,
#    and repoints the Telegram webhook)
sudo bash deploy/setup.sh bot.text.bz
```

## What setup.sh does

- Installs **Node 20** and **Caddy** (auto-TLS reverse proxy 443 → 127.0.0.1:3000)
- `npm ci && npm run build`
- Installs the **systemd** service `tgsecretarybot` (auto-restart, journald logs)
- Installs the **cron** jobs (`/etc/cron.d/tgsecretarybot`) that replace vercel.json
- Calls Telegram **setWebhook** → `https://your-domain/api/telegram`

## After install — verify

```bash
systemctl status tgsecretarybot
journalctl -u tgsecretarybot -f
curl -s "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"   # url should be your domain
```

Then send yourself a Telegram message and confirm it's logged (dashboard
`/messages`).

## Updating later

Automatic — nothing to do. `setup.sh` installs
`tgsecretarybot-autodeploy.timer`, which **every minute** checks the
branch and, when a new commit is pushed, runs `deploy/auto-deploy.sh`
(pull → `npm ci` → build → restart) and pings you on Telegram. It
no-ops when there's nothing new, and a flock prevents overlapping
builds.

Watch it:
```bash
systemctl list-timers tgsecretarybot-autodeploy.timer
tail -f /var/log/tgsecretarybot-autodeploy.log
```

Manual one-off (if you ever need it): `sudo bash deploy/deploy.sh`.

### Optional: instant deploy via GitHub Actions
`.github/workflows/deploy.yml` SSHes in and deploys the moment you push
(vs. up to 1 min for the timer). Add three repo secrets to enable it:
`SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` (public half in the server's
`~/.ssh/authorized_keys`). Until `SSH_HOST` is set it just skips — the
on-server timer keeps working either way.

## Also move (not automated — do when ready)

- **Resend inbound email webhook** → `https://your-domain/api/webhooks/...`
- **Android SMS-Forwarder URL** → `https://your-domain/api/sms-webhook?...`
- **Per-account email domains** (rateklend.text.bz, …) DNS/MX as needed

## Rollback

Nothing is destructive. To fall back to Vercel, just re-point the
Telegram webhook to the Vercel URL:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://tgsecretarybot.vercel.app/api/telegram \
  -d secret_token=<WEBHOOK_SECRET_TOKEN>
```

## Security reminders

- `chmod 600 .env` — it holds every secret.
- Change the root password after setup (`passwd`) and switch to SSH keys.
- Keep 5432 firewalled off the public internet.
