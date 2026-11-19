#!/usr/bin/env bash
# Runs the popup UI tests headlessly.
#
# The popup needs a DOM, so these run in Chrome rather than Node. A static server
# is used instead of file:// because the runner fetches extension/popup.html, and
# file:// would be blocked by the same-origin policy.
#
#   make test-ui
#   tests/ui/runner.html   (open in a browser to watch it, no server needed if
#                           your browser allows the fetch; otherwise serve this dir)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${DESKSYNC_TEST_PORT:-8771}"

CHROME=""
for c in google-chrome chromium chromium-browser; do
  if command -v "$c" >/dev/null 2>&1; then CHROME="$(command -v "$c")"; break; fi
done
if [ -z "$CHROME" ]; then
  for c in "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome; do
    [ -x "$c" ] && CHROME="$c" && break
  done
fi
if [ -z "$CHROME" ]; then
  echo "ui tests skipped: no Chrome found (install Chrome/Chromium, or open tests/ui/runner.html by hand)"
  exit 0
fi

python3 -m http.server "$PORT" --directory "$ROOT" >/dev/null 2>&1 &
SERVER=$!
trap 'kill $SERVER 2>/dev/null' EXIT

# Wait for the server rather than sleeping a fixed amount.
for _ in $(seq 1 50); do
  if curl -sf -o /dev/null "http://127.0.0.1:$PORT/tests/ui/runner.html"; then break; fi
  sleep 0.1
done

PROFILE="$(mktemp -d)"
trap 'kill $SERVER 2>/dev/null; rm -rf "$PROFILE"' EXIT

OUT="$("$CHROME" \
  --headless=new --disable-gpu --no-sandbox --no-first-run \
  --user-data-dir="$PROFILE" \
  --virtual-time-budget=60000 \
  --dump-dom "http://127.0.0.1:$PORT/tests/ui/runner.html" 2>/dev/null)"

# The report div carries the counts; the lines are printed for a failing run.
PASS="$(printf '%s' "$OUT" | grep -o 'data-pass="[0-9]*"' | head -1 | tr -dc '0-9')"
FAIL="$(printf '%s' "$OUT" | grep -o 'data-fail="[0-9]*"' | head -1 | tr -dc '0-9')"

if [ -z "${PASS:-}" ] || [ -z "${FAIL:-}" ]; then
  echo "ui tests: the runner did not finish — no result found in the page"
  printf '%s\n' "$OUT" | sed -n '1,40p'
  exit 1
fi

echo "popup UI"
printf '%s' "$OUT" \
  | sed -e 's/&lt;/</g; s/&gt;/>/g; s/&amp;/\&/g' \
  | grep -oE '<span class="(ok|no|grp)">[^<]*</span>[^<]*' \
  | sed -e 's/<span class="grp">/\n/' -e 's/<span class="ok">/ /' -e 's/<span class="no">/ /' -e 's#</span>##'

echo
if [ "$FAIL" -gt 0 ]; then
  echo "$PASS passed, $FAIL FAILED"
  exit 1
fi
echo "$PASS passed"
