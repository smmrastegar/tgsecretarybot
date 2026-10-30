#!/usr/bin/env bash
# Telegram's local Bot API server (github.com/tdlib/telegram-bot-api): a bot that talks to it can download files up to 2 GB
# (the public Bot API stops at 20 MB). Built from source (no docker here), run as the systemd unit tgsb-botapi on 127.0.0.1:8081.
# The Telegram app id / hash come from the app's settings (dashboard → Music → "فایل‌های بزرگ"), never from the repo.
# Idempotent; does nothing until both are saved. Writes a one-line result to $TOOLS/botapi.status.
set -uo pipefail
APP=/opt/tgsecretarybot
TOOLS=/var/lib/tgsb-tools
STATUS="$TOOLS/botapi.status"
SRC="$TOOLS/telegram-bot-api-src"
BIN=/usr/local/bin/telegram-bot-api
ENVF=/etc/tgsb-botapi.env
UNIT=/etc/systemd/system/tgsb-botapi.service
DATA=/var/lib/tgsb-botapi
LOGF="$TOOLS/botapi-build.log"
mkdir -p "$TOOLS"

say() { echo "$(date -Is) $*" >"$STATUS"; echo "$*"; }
report() {
  local tok msg lvl=warn
  tok=$(grep -E '^WEBHOOK_SECRET_TOKEN=' "$APP/.env" 2>/dev/null | cut -d= -f2- || true)
  msg=$(tr -d '"\\' <"$STATUS" 2>/dev/null | tr '\n' ' ' | cut -c1-300)
  case "$msg" in *" OK"*|*" building"*|*" idle"*) lvl=info ;; esac
  [[ -n "${tok:-}" ]] && curl -fsS -m 10 -X POST "http://127.0.0.1:3000/api/deploy-status" -H "Content-Type: application/json" -H "x-deploy-token: ${tok}" --data-raw "{\"source\":\"botapi\",\"level\":\"$lvl\",\"message\":\"${msg:-no status}\"}" >/dev/null 2>&1 || true
}

tok=$(grep -E '^WEBHOOK_SECRET_TOKEN=' "$APP/.env" 2>/dev/null | cut -d= -f2- || true)
[[ -n "${tok:-}" ]] || exit 0
cfg=$(curl -fsS -m 10 -H "x-deploy-token: ${tok}" http://127.0.0.1:3000/api/deploy-status 2>/dev/null) || exit 0
api_id=$(printf '%s' "$cfg" | python3 -c 'import sys,json;print(json.load(sys.stdin)["botapi"]["apiId"])' 2>/dev/null || true)
api_hash=$(printf '%s' "$cfg" | python3 -c 'import sys,json;print(json.load(sys.stdin)["botapi"]["apiHash"])' 2>/dev/null || true)
if [[ -z "$api_id" || -z "$api_hash" ]]; then say "idle: api_id / api_hash not saved yet"; exit 0; fi

want=$(printf 'TELEGRAM_API_ID=%s\nTELEGRAM_API_HASH=%s\n' "$api_id" "$api_hash")

# Fast path (runs every deploy tick): built, configured, running.
if [[ -x "$BIN" && "$(cat "$ENVF" 2>/dev/null)" == "$want" ]] && systemctl is-active --quiet tgsb-botapi; then
  grep -q " OK" "$STATUS" 2>/dev/null || { say "OK telegram-bot-api running on 127.0.0.1:8081"; report; }
  exit 0
fi

if [[ ! -x "$BIN" ]]; then
  say "building telegram-bot-api from source (20-60 min, low priority)"; report
  export DEBIAN_FRONTEND=noninteractive
  if ! { apt-get update -qq && apt-get install -y -qq make git zlib1g-dev libssl-dev gperf cmake g++; } >>"$LOGF" 2>&1; then say "FAIL installing build tools (apt): see $LOGF"; report; exit 1; fi
  rm -rf "$SRC"
  if ! git clone --quiet --recurse-submodules --shallow-submodules --depth 1 https://github.com/tdlib/telegram-bot-api.git "$SRC" >>"$LOGF" 2>&1; then say "FAIL git clone telegram-bot-api"; report; exit 1; fi
  mkdir -p "$SRC/build"
  cd "$SRC/build" || exit 1
  # A pip-installed "cmake" shim in /usr/local/bin can shadow the real one and fail to start: use the first cmake that answers.
  CMAKE=""
  for c in /usr/bin/cmake /usr/local/bin/cmake "$(command -v cmake || true)"; do
    [[ -n "$c" && -x "$c" ]] && "$c" --version >/dev/null 2>&1 && { CMAKE="$c"; break; }
  done
  if [[ -z "$CMAKE" ]]; then say "FAIL no working cmake found"; report; exit 1; fi
  # Run the build in the background and show its progress (the percentage cmake prints) in the status file every 30 s and in the System Log every 5 min.
  : >"$LOGF.build"
  { nice -n 15 "$CMAKE" -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX:PATH=/usr/local .. && nice -n 15 "$CMAKE" --build . --target install -j2; } >>"$LOGF.build" 2>&1 &
  bpid=$!
  ticks=0
  while kill -0 "$bpid" 2>/dev/null; do
    sleep 30; ticks=$((ticks + 1))
    pct=$(grep -oE '^\[ *[0-9]+%\]' "$LOGF.build" 2>/dev/null | tail -1 | tr -d '[] ' || true)
    say "building telegram-bot-api: ${pct:-starting} (started $(( ticks / 2 )) min ago)"
    (( ticks % 10 == 0 )) && report
  done
  if ! wait "$bpid"; then
    cat "$LOGF.build" >>"$LOGF" 2>/dev/null
    say "FAIL build telegram-bot-api: $(tail -3 "$LOGF.build" | tr -d '\r' | tr '\n' ' ' | cut -c1-250)"; report; exit 1
  fi
  rm -rf "$SRC"
fi

umask 077
printf '%s\n' "$want" >"$ENVF"
umask 022
mkdir -p "$DATA" /tmp/tgsb-botapi
cat >"$UNIT" <<UNIT
[Unit]
Description=Telegram local Bot API server (files over 20 MB for the intake's large-file bot)
After=network.target

[Service]
EnvironmentFile=$ENVF
ExecStart=$BIN --local --http-ip-address=127.0.0.1 --http-port=8081 --dir=$DATA --temp-dir=/tmp/tgsb-botapi
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable tgsb-botapi >/dev/null 2>&1
systemctl restart tgsb-botapi
sleep 4
if curl -s -m 5 -o /dev/null http://127.0.0.1:8081/; then say "OK telegram-bot-api running on 127.0.0.1:8081"; else say "FAIL telegram-bot-api service does not answer: $(journalctl -u tgsb-botapi -n 3 --no-pager 2>/dev/null | tr '\n' ' ' | cut -c1-200)"; fi
report
