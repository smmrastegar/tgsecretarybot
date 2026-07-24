#!/usr/bin/env bash
# Update to the latest code and restart. Run after the initial setup.sh.
#   cd /opt/tgsecretarybot && sudo bash deploy/deploy.sh
set -euo pipefail
APP_DIR=/opt/tgsecretarybot
cd "$APP_DIR"

echo "==> git pull"
git fetch origin
git checkout claude/telegram-secretary-bot-A0UsO
git pull --ff-only origin claude/telegram-secretary-bot-A0UsO

echo "==> install + build"
npm ci
npm run build

echo "==> restart"
systemctl restart tgsecretarybot
sleep 2
systemctl --no-pager --lines=5 status tgsecretarybot || true
echo "✅ deployed."
