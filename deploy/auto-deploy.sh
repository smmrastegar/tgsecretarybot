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
  local begin="# managed:wildcard-vhost:begin"
  local endm="# managed:wildcard-vhost:end"
  local tmp addr port desired
  if ! command -v caddy >/dev/null; then
    report_status "caddy" "error" "caddy binary not on PATH — cannot manage the wildcard vhost"
    return 0
  fi
  if [[ ! -f "$caddyfile" ]]; then
    report_status "caddy" "error" "no $caddyfile on this box — caddy may not be the reverse proxy"
    return 0
  fi

  # Derive the listener from the FIRST site block and reuse it verbatim.
  # This box serves bot.text.bz on :8443 (a Cloudflare-supported origin
  # port), not :443. A wildcard block written without the port defaults
  # to :443, which Caddy treats as a second server on a port something
  # else already holds — "listening on :443: bind: address already in
  # use", and the reload fails while the file looks perfectly correct.
  addr=$(grep -m1 -E '^[^[:space:]#].*\{[[:space:]]*$' "$caddyfile" | awk '{print $1}')
  port=""
  case "$addr" in *:*) port=":${addr##*:}" ;; esac
  desired="*.text.bz${port}"

  # Regenerate rather than skip-if-present: the first version treated its
  # own marker as proof of success, so a block that was written but never
  # loaded could never be corrected.
  tmp=$(mktemp) || return 0
  awk -v b="$begin" -v e="$endm" '
    index($0, b) { drop=1 }
    index($0, "managed:wildcard-vhost") && !drop { legacy=1; next }
    legacy { if ($0 == "}") legacy=0; next }
    drop { if (index($0, e)) drop=0; next }
    { print }
  ' "$caddyfile" >"$tmp"

  # Trim trailing blank lines, or the separator below accumulates one
  # extra per run and cmp never reports the file as unchanged.
  printf '%s\n' "$(cat "$tmp")" >"${tmp}.trim" && mv "${tmp}.trim" "$tmp"

  {
    echo ""
    echo "$begin  (deploy/auto-deploy.sh — do not edit between the markers)"
    echo "$desired {"
    echo "	tls internal"
    echo "	encode zstd gzip"
    echo "	reverse_proxy 127.0.0.1:3000"
    echo "}"
    echo "$endm"
  } >>"$tmp"

  if cmp -s "$tmp" "$caddyfile"; then rm -f "$tmp"; return 0; fi

  if caddy validate --adapter caddyfile --config "$tmp" >/dev/null 2>&1; then
    mkdir -p /var/backups
    cp "$caddyfile" "/var/backups/Caddyfile.$(date +%s)"
    cp "$tmp" "$caddyfile"
    if systemctl reload caddy >/dev/null 2>&1; then
      echo "  ✓ caddy: wildcard vhost ${desired} loaded"
      report_status "caddy" "warn" "wildcard vhost ${desired} installed and caddy reloaded"
    else
      echo "  ✗ caddy: reload failed for ${desired}"
      report_status "caddy" "error" "wildcard vhost ${desired} written but caddy reload FAILED"
    fi
  else
    echo "  ✗ caddy: validate failed — config left untouched"
    report_status "caddy" "error" "caddy validate rejected wildcard vhost ${desired}; config untouched"
  fi
  rm -f "$tmp"
}
caddy_vhost_selfheal >>"$LOG" 2>&1 || true

# Self-heal the cron table. setup.sh writes /etc/cron.d/tgsecretarybot
# exactly once at install, so a job added to deploy/crontab later never
# reached the box — the retention job would have sat in git and never
# run. Regenerate from the repo copy whenever it differs, using the same
# substitution setup.sh uses.
cron_selfheal() {
  local target=/etc/cron.d/tgsecretarybot
  local secret tmp
  secret=$(grep -E '^CRON_SECRET=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  if [[ -z "${secret:-}" ]]; then
    report_status "cron" "error" "CRON_SECRET missing from .env — cron table not installed"
    return 0
  fi
  tmp=$(mktemp) || return 0
  sed "s/__CRON_SECRET__/${secret}/g" "$APP_DIR/deploy/crontab" >"$tmp"
  if [[ -f "$target" ]] && cmp -s "$tmp" "$target"; then rm -f "$tmp"; return 0; fi
  cp "$tmp" "$target" && chmod 644 "$target"
  rm -f "$tmp"
  echo "  ✓ cron: /etc/cron.d/tgsecretarybot regenerated from deploy/crontab"
  report_status "cron" "warn" "cron table regenerated from deploy/crontab"
}
cron_selfheal >>"$LOG" 2>&1 || true

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
