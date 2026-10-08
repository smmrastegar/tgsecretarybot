#!/usr/bin/env bash
# Python environment for deploy/audio-analyze.py (numpy only) plus a check
# that an ffmpeg is available. Idempotent. Result line → $TOOLS/analyzer.status
set -uo pipefail
TOOLS=/var/lib/tgsb-tools
VENV="$TOOLS/analyzer"
STATUS="$TOOLS/analyzer.status"
mkdir -p "$TOOLS"
say() { echo "$(date -Is) $*" >"$STATUS"; echo "$*"; }

command -v python3 >/dev/null || { say "FAIL python3 missing"; exit 1; }
if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV" 2>&1 || { say "FAIL venv"; exit 1; }
fi
"$VENV/bin/python" -c "import numpy" 2>/dev/null || "$VENV/bin/pip" install --quiet numpy 2>&1 | tail -2
"$VENV/bin/python" -c "import numpy" 2>/dev/null || { say "FAIL numpy install"; exit 1; }
FF=""
for p in "$TOOLS/home/.config/spotdl/ffmpeg" /usr/bin/ffmpeg /usr/local/bin/ffmpeg; do [[ -x "$p" ]] && FF="$p" && break; done
if [[ -z "$FF" ]]; then
  say "FAIL no ffmpeg (spotDL setup downloads one into $TOOLS/home/.config/spotdl)"
else
  say "OK numpy $("$VENV/bin/python" -c 'import numpy;print(numpy.__version__)') ffmpeg $FF"
fi

report() {
  local tok msg lvl=warn
  tok=$(grep -E '^WEBHOOK_SECRET_TOKEN=' /opt/tgsecretarybot/.env 2>/dev/null | cut -d= -f2- || true)
  msg=$(tr -d '"\\' <"$STATUS" 2>/dev/null | tr '\n' ' ' | cut -c1-300)
  case "$msg" in *" OK"*) lvl=info ;; esac
  [[ -n "${tok:-}" ]] && curl -fsS -m 10 -X POST "http://127.0.0.1:3000/api/deploy-status" -H "Content-Type: application/json" -H "x-deploy-token: ${tok}" --data-raw "{\"source\":\"analyzer\",\"level\":\"$lvl\",\"message\":\"${msg:-no status}\"}" >/dev/null 2>&1 || true
}
report
exit 0
