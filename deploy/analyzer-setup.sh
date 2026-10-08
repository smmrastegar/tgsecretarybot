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

# --- optional ML stage: essentia-tensorflow + Discogs-EffNet models (CC BY-NC-SA,
# personal use). Needs ~1.5 GB for the wheel and a Python version it ships for;
# without it the analyzer still runs on the numpy features alone.
MODELS="$TOOLS/models"
ML="none"
if "$VENV/bin/python" -c "import essentia.standard" 2>/dev/null; then ML="ok"
else
  FREE_KB=$(df -k "$TOOLS" | awk 'NR==2{print $4}')
  if [[ "${FREE_KB:-0}" -gt 3000000 ]]; then
    "$VENV/bin/pip" install --quiet essentia-tensorflow 2>&1 | tail -2
    "$VENV/bin/python" -c "import essentia.standard" 2>/dev/null && ML="ok" || ML="wheel-failed"
  else
    ML="low-disk"
  fi
fi
if [[ "$ML" == "ok" ]]; then
  mkdir -p "$MODELS"
  B=https://essentia.upf.edu/models
  get() { [[ -s "$MODELS/$(basename "$1")" ]] || curl -fsSL -m 180 -o "$MODELS/$(basename "$1")" "$B/$1" || rm -f "$MODELS/$(basename "$1")"; }
  get feature-extractors/discogs-effnet/discogs-effnet-bs64-1.pb
  get classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb
  get classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json
  for n in mood_happy mood_sad mood_aggressive mood_relaxed danceability voice_instrumental; do get classification-heads/$n/$n-discogs-effnet-1.pb; done
  [[ -s "$MODELS/discogs-effnet-bs64-1.pb" && -s "$MODELS/genre_discogs400-discogs-effnet-1.pb" ]] || ML="models-failed"
fi
if [[ -z "$FF" ]]; then
  say "FAIL no ffmpeg (spotDL setup downloads one into $TOOLS/home/.config/spotdl)"
else
  say "OK numpy $("$VENV/bin/python" -c 'import numpy;print(numpy.__version__)') ffmpeg $FF ml=$ML"
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
