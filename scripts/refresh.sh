#!/bin/bash
# Daily refresh of the profile card (run by launchd: com.nickadian.profile-stats).
# Rebuilds the card and pushes only when a number changed. The commit uses an
# email that is not on the GitHub account, so the refresh itself never counts
# as a contribution and cannot keep a streak alive.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE="$(command -v node || ls -d "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null | sort -V | tail -1)"
[ -x "$NODE" ] || { echo "node not found"; exit 1; }

echo "== $(date '+%Y-%m-%d %H:%M:%S')"
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean, skipping"; exit 1; }
git pull -q --ff-only origin main
"$NODE" scripts/build-stats.mjs > /dev/null
if [ -z "$(git status --porcelain profile)" ]; then echo "no change"; exit 0; fi
git add profile
git -c user.name="profile-stats" -c user.email="profile-stats@localhost.invalid" \
  commit -q --no-verify -m "Refresh stats"
git push -q origin main
echo "pushed $(git rev-parse --short HEAD)"
