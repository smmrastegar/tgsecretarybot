# Self-hosting tgsecretarybot on the DB server (209.97.138.127)

Move the app off Vercel onto the same box that already runs Postgres.
This removes the serverless pain (function freezes, cold starts,
maxDuration) and makes every DB query a localhost round-trip.

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
git clone <your repo url> tgsecretarybot   # or copy the repo here
cd tgsecretarybot
git checkout claude/telegram-secretary-bot-A0UsO

# 1) create the env file and fill it from your Vercel env vars
cp deploy/.env.template .env
nano .env            # DATABASE_URL host → 127.0.0.1 ; NEXT_PUBLIC_APP_URL → your domain
chmod 600 .env

# 2) run the bootstrap (installs Node+Caddy, builds, wires systemd+cron,
#    and repoints the Telegram webhook)
sudo bash deploy/setup.sh your-domain.example
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

```bash
cd /opt/tgsecretarybot && sudo bash deploy/deploy.sh
```

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
