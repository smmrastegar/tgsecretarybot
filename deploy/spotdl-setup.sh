#!/usr/bin/env bash
# Install spotDL (https://github.com/spotdl/spotify-downloader) into an
# isolated venv — the music library's fallback downloader for tracks the
# Telegram downloader bot does not have. Idempotent; safe to re-run.
# Writes a one-line result to $TOOLS/spotdl.status.
set -uo pipefail
TOOLS=/var/lib/tgsb-tools
VENV="$TOOLS/spotdl"
export HOME="$TOOLS/home"
STATUS="$TOOLS/spotdl.status"
mkdir -p "$TOOLS" "$HOME"

say() { echo "$(date -Is) $*" >"$STATUS"; echo "$*"; }

if [[ ! -x "$VENV/bin/spotdl" ]]; then
  command -v python3 >/dev/null || { say "FAIL python3 missing"; exit 1; }
  python3 -m venv "$VENV" 2>&1 || { say "FAIL venv (apt install python3-venv?)"; exit 1; }
  "$VENV/bin/pip" install --quiet --upgrade pip spotdl 2>&1 | tail -3
  [[ -x "$VENV/bin/spotdl" ]] || { say "FAIL pip install spotdl"; exit 1; }
fi
# ffmpeg / deno: use system ones when present, else spotDL's own download.
command -v ffmpeg >/dev/null || [[ -e "$HOME/.config/spotdl/ffmpeg" ]] || "$VENV/bin/spotdl" --download-ffmpeg 2>&1 | tail -1
command -v deno >/dev/null || [[ -e "$HOME/.config/spotdl/deno" ]] || "$VENV/bin/spotdl" --download-deno 2>&1 | tail -1

# Self-test once (and again after every upgrade attempt that changed nothing
# is pointless, so only when no OK is recorded).
if ! grep -q "^.* OK" "$STATUS" 2>/dev/null; then
  T=$(mktemp -d)
  if timeout 240 "$VENV/bin/spotdl" download "https://open.spotify.com/track/1Ba0n7Acuz2lOEw1XBdMZP" --format mp3 --bitrate 192k --output "$T/{track-id}.{output-ext}" >"$T/log" 2>&1 && ls "$T"/*.mp3 >/dev/null 2>&1; then
    say "OK self-test downloaded $(du -k "$T"/*.mp3 | cut -f1) KB"
  else
    say "FAIL self-test: $(tr -d '\r' <"$T/log" | grep -v '^\s*$' | tail -3 | tr '\n' ' ' | cut -c1-300)"
  fi
  rm -rf "$T"
fi
exit 0
