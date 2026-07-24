#!/usr/bin/env bash
# Poll the tracked branch and redeploy ONLY when a new commit lands.
# Optimised for speed: dependencies are re-installed ONLY when the
# lockfile actually changed (most deploys are code-only), and the
# Next.js build reuses .next/cache for incremental compiles. A flock
# stops overlapping builds.
set -euo pipefail

APP_DIR=/opt/tgsecretarybot
BRANCH=claude/telegram-secretary-bot-A0UsO
LOCK=/run/tgsecretarybot-autodeploy.lock
LOG=/var/log/tgsecretarybot-autodeploy.log

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) busy, skip" >>"$LOG"; exit 0; }

cd "$APP_DIR"
git fetch --quiet origin "$BRANCH"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
if [[ "$LOCAL" == "$REMOTE" ]]; then exit 0; fi

{
  START=$(date +%s)
  echo "$(date -Is) → deploying ${REMOTE:0:7} (was ${LOCAL:0:7})"
  DEPS_CHANGED=$(git diff --name-only "$LOCAL" "$REMOTE" | grep -cE '^(package-lock\.json|package\.json)$' || true)
  git reset --hard --quiet "$REMOTE"
  if [[ "$DEPS_CHANGED" != "0" ]]; then
    echo "  deps changed → npm ci"
    npm ci --no-audit --no-fund --prefer-offline
  else
    echo "  no dep change → skipping install"
  fi
  npm run build
  systemctl restart tgsecretarybot
  echo "$(date -Is) ✓ deploy OK → ${REMOTE:0:7} in $(( $(date +%s) - START ))s"
} >>"$LOG" 2>&1

# Self-heal the timer cadence (faster pickup) if the on-disk unit is stale.
if ! grep -q "OnUnitActiveSec=30" /etc/systemd/system/tgsecretarybot-autodeploy.timer 2>/dev/null; then
  cp "$APP_DIR/deploy/tgsecretarybot-autodeploy.timer" /etc/systemd/system/tgsecretarybot-autodeploy.timer 2>/dev/null || true
  systemctl daemon-reload 2>/dev/null || true
  systemctl restart tgsecretarybot-autodeploy.timer 2>/dev/null || true
fi

# Best-effort Telegram notice.
BOT_TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
OWNER=$(grep -E '^OWNER_NOTIFY_CHAT_ID=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
if [[ -n "${BOT_TOKEN:-}" && -n "${OWNER:-}" ]]; then
  curl -fsS "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -d "chat_id=${OWNER}" -d "disable_notification=true" \
    --data-urlencode "text=🚀 دیپلوی خودکار — کامیت ${REMOTE:0:7}" >/dev/null 2>&1 || true
fi
