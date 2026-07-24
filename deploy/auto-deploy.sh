#!/usr/bin/env bash
# Poll the tracked branch and redeploy ONLY when a new commit lands.
# Run by the systemd timer (deploy/tgsecretarybot-autodeploy.timer) every
# minute, or from cron. Safe to run often: it's a no-op unless the remote
# HEAD moved, and a flock stops overlapping builds.
set -euo pipefail

APP_DIR=/opt/tgsecretarybot
BRANCH=claude/telegram-secretary-bot-A0UsO
LOCK=/run/tgsecretarybot-autodeploy.lock
LOG=/var/log/tgsecretarybot-autodeploy.log

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) another deploy in progress, skipping" >>"$LOG"; exit 0; }

cd "$APP_DIR"

git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0   # nothing new
fi

{
  echo "$(date -Is) new commit $REMOTE (was $LOCAL) — deploying"
  git checkout --quiet "$BRANCH"
  git reset --hard --quiet "origin/$BRANCH"
  npm ci
  npm run build
  systemctl restart tgsecretarybot
  echo "$(date -Is) deploy OK → $REMOTE"
} >>"$LOG" 2>&1

# Fire a one-line Telegram notice if we can read the secret + owner chat.
BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
OWNER=$(grep -E '^OWNER_NOTIFY_CHAT_ID=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
if [[ -n "${BOT_TOKEN:-}" && -n "${OWNER:-}" ]]; then
  SHORT=${REMOTE:0:7}
  curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${OWNER}" -d "disable_notification=true" \
    --data-urlencode "text=🚀 دیپلوی خودکار انجام شد — کامیت ${SHORT}" >/dev/null 2>&1 || true
fi
