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

# Best-effort operator ping, shared by the deploy notice and the
# self-heal blocks below.
# Report a deploy-box event into the app's System Log. The self-heal
# blocks below used to write only to $LOG, which meant a failure and a
# block that never ran looked identical from outside the box.
report_status() {
  local tok
  tok=$(grep -E '^WEBHOOK_SECRET_TOKEN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  [[ -n "${tok:-}" ]] || return 0
  curl -fsS -m 10 -X POST "http://127.0.0.1:3000/api/deploy-status" \
    -H "Content-Type: application/json" -H "x-deploy-token: ${tok}" \
    --data-raw "{\"source\":\"$1\",\"level\":\"$2\",\"message\":\"$3\"}" \
    >/dev/null 2>&1 || true
}

notify_owner() {
  local tok owner
  tok=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  owner=$(grep -E '^OWNER_NOTIFY_CHAT_ID=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  [[ -n "${tok:-}" && -n "${owner:-}" ]] || return 0
  curl -fsS "https://api.telegram.org/bot${tok}/sendMessage" \
    -d "chat_id=${owner}" -d "disable_notification=true" \
    --data-urlencode "text=$1" >/dev/null 2>&1 || true
}

exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) busy, skip" >>"$LOG"; exit 0; }

cd "$APP_DIR"

# Self-heal the Caddy vhost for per-account email subdomains.
# Cloudflare proxies *.text.bz to this box, but Caddy only knows
# bot.text.bz, so every other subdomain got an empty response (CF 520)
# and the email cards' Preview/Text/HTML links were dead.
#
# `tls internal` is deliberate: the zone runs SSL mode "Full" (not
# strict), so Cloudflare encrypts to the origin without validating the
# certificate. That lets Caddy serve its own local CA cert and avoids
# needing a wildcard ACME cert (which would require a DNS-01 challenge
# and the Cloudflare DNS plugin baked into the Caddy binary).
#
# Explicit site blocks beat wildcards in Caddy, so bot.text.bz keeps
# its own block untouched.
#
# The new config is validated in a temp file BEFORE it is copied into
# place — /etc/caddy/Caddyfile is never left in a state Caddy can't
# parse, and a failed validation leaves the running config alone.
caddy_vhost_selfheal() {
  local caddyfile=/etc/caddy/Caddyfile
  local marker="# managed:wildcard-vhost"
  local tmp
  if ! command -v caddy >/dev/null; then
    report_status "caddy" "error" "caddy binary not on PATH — cannot add the wildcard vhost"
    return 0
  fi
  if [[ ! -f "$caddyfile" ]]; then
    report_status "caddy" "error" "no $caddyfile on this box — caddy may not be the reverse proxy"
    return 0
  fi
  grep -qF "$marker" "$caddyfile" && return 0
  tmp=$(mktemp) || return 0
  cat "$caddyfile" >"$tmp"
  cat >>"$tmp" <<'CADDY'

# managed:wildcard-vhost — added by deploy/auto-deploy.sh
*.text.bz {
	tls internal
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
  if caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    mkdir -p /var/backups
    cp "$caddyfile" "/var/backups/Caddyfile.$(date +%s)"
    cp "$tmp" "$caddyfile"
    if systemctl reload caddy >/dev/null 2>&1; then
      echo "  ✓ caddy: wildcard vhost added + reloaded"
    report_status "caddy" "warn" "wildcard vhost *.text.bz added and caddy reloaded"
    else
      echo "  ✗ caddy: reload failed after adding wildcard vhost"
      report_status "caddy" "error" "wildcard vhost written but caddy reload FAILED"
    fi
  else
    echo "  ✗ caddy: validate failed — config left untouched"
    report_status "caddy" "error" "caddy validate rejected the wildcard vhost; config left untouched"
    notify_owner "⚠️ کدی: افزودن vhost وایلدکارت رد شد (validate failed) — کانفیگ دست‌نخورده موند"
  fi
  rm -f "$tmp"
}
caddy_vhost_selfheal >>"$LOG" 2>&1 || true

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
notify_owner "🚀 دیپلوی خودکار — کامیت ${REMOTE:0:7}"
