#!/usr/bin/env bash
# One-time server bootstrap for tgsecretarybot on Ubuntu (the box that
# already runs Postgres). Idempotent — safe to re-run. Run as root.
#
#   cd /opt/tgsecretarybot && sudo bash deploy/setup.sh YOUR-DOMAIN
#
# It installs Node 20 + Caddy, wires the systemd service + cron, and
# does the first build. It does NOT touch Postgres or your .env — create
# /opt/tgsecretarybot/.env from deploy/.env.template FIRST.
set -euo pipefail

APP_DIR=/opt/tgsecretarybot
DOMAIN="${1:-}"

if [[ $EUID -ne 0 ]]; then echo "run as root (sudo)"; exit 1; fi
if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "!! $APP_DIR/.env missing — copy deploy/.env.template to .env and fill it first."; exit 1
fi
if [[ -z "$DOMAIN" ]]; then echo "usage: setup.sh YOUR-DOMAIN"; exit 1; fi

echo "==> [1/6] Node 24 (NodeSource) — matches package.json engines (24.x)"
if ! command -v node >/dev/null || [[ "$(node -v | cut -dv -f2 | cut -d. -f1)" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [2/6] Caddy (auto-HTTPS reverse proxy)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi
sed "s/YOUR-DOMAIN/${DOMAIN}/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> [3/6] Build the app"
cd "$APP_DIR"
npm ci
npm run build

echo "==> [4/6] systemd service + auto-deploy timer"
cp "$APP_DIR/deploy/tgsecretarybot.service" /etc/systemd/system/tgsecretarybot.service
cp "$APP_DIR/deploy/tgsecretarybot-autodeploy.service" /etc/systemd/system/tgsecretarybot-autodeploy.service
cp "$APP_DIR/deploy/tgsecretarybot-autodeploy.timer" /etc/systemd/system/tgsecretarybot-autodeploy.timer
chmod +x "$APP_DIR/deploy/auto-deploy.sh"
systemctl daemon-reload
systemctl enable tgsecretarybot
systemctl restart tgsecretarybot
# Auto-deploy: polls the branch every minute, redeploys on a new commit.
systemctl enable --now tgsecretarybot-autodeploy.timer

echo "==> [5/6] cron jobs"
CRON_SECRET="$(grep -E '^CRON_SECRET=' "$APP_DIR/.env" | cut -d= -f2-)"
if [[ -n "$CRON_SECRET" ]]; then
  sed "s/__CRON_SECRET__/${CRON_SECRET}/g" "$APP_DIR/deploy/crontab" > /etc/cron.d/tgsecretarybot
  chmod 644 /etc/cron.d/tgsecretarybot
  echo "   cron installed."
else
  echo "   !! CRON_SECRET empty in .env — skipped cron. Set it and re-run."
fi

echo "==> [6/6] Point Telegram's webhook at this server"
BOT_TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN=' "$APP_DIR/.env" | cut -d= -f2-)"
WH_SECRET="$(grep -E '^WEBHOOK_SECRET_TOKEN=' "$APP_DIR/.env" | cut -d= -f2-)"
if [[ -n "$BOT_TOKEN" ]]; then
  curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook" \
    -d "url=https://${DOMAIN}/api/telegram" \
    -d "secret_token=${WH_SECRET}" \
    -d 'allowed_updates=["message","edited_message","channel_post","edited_channel_post","business_connection","business_message","edited_business_message","deleted_business_messages","message_reaction","callback_query","my_chat_member","chat_member"]' \
    && echo && echo "   webhook set → https://${DOMAIN}/api/telegram"
fi

echo
echo "✅ Done. Check:  systemctl status tgsecretarybot ; journalctl -u tgsecretarybot -f"
echo "   Verify webhook:  curl -s https://api.telegram.org/bot\$TOKEN/getWebhookInfo"
