#!/usr/bin/env bash
# One source: the game of the web repo at one commit becomes the app's assets/www.
#   scripts/sync_web.sh <web git dir> <commit>
# Writes app/src/main/assets/www (public/ of that commit, untouched), www/mode.js (the app's flags, the only file
# that differs from the web), assets/www.sha256 (hash of www without mode.js) and assets/web_commit.txt.
# Nothing written here is committed (.gitignore): the game never lives in this public repository.
set -euo pipefail
WEB="$1"; COMMIT="$2"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$HERE/app/src/main/assets"
rm -rf "$ASSETS/www" "$ASSETS/www.sha256" "$ASSETS/web_commit.txt"
mkdir -p "$ASSETS/www"
git -C "$WEB" archive --format=tar "$COMMIT" public | tar -x -C "$ASSETS/www" --strip-components=1
[ -f "$ASSETS/www/index.html" ] || { echo "::error::public/index.html missing at $COMMIT"; exit 1; }
cat > "$ASSETS/www/mode.js" <<'EOF'
/* Mind Garden: the Android app build (written by MIND_GARDEN_ANDROID/scripts/sync_web.sh, not by the web repo).
 * No login, no Global scores, no online voices; the Android bridge (MGTts, MGUpdate, MGApp, the back button);
 * the version check of the app; the recorded clips are inside the app. */
window.MG_MODE = { name: 'app', login: false, globalScores: false, onlineVoices: false, bridge: true, updater: true, bundledAudio: true };
EOF
python3 "$HERE/scripts/www_hash.py" "$ASSETS/www" > "$ASSETS/www.sha256"
printf '%s\n' "$COMMIT" > "$ASSETS/web_commit.txt"
echo "assets/www: $(find "$ASSETS/www" -type f | wc -l | tr -d ' ') files, $(du -sh "$ASSETS/www" | cut -f1), hash $(cat "$ASSETS/www.sha256")"
