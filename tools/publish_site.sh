#!/usr/bin/env bash
# Publishes dist/site to the VPS, where desksync.org is served from
# (deploy/vps/: a small Caddy container behind the server's main Caddy).
# The files are copied over; nothing is restarted.
#
#   make publish-site            (host from VPS_HOST in .env, default khoaiz-vps)
set -eu
cd "$(dirname "$0")/.."
SITE="$PWD/dist/site"
HOST="${VPS_HOST:-khoaiz-vps}"
DEST="/home/ubuntu/desksync/site/"
[ -f "$SITE/index.html" ] || { echo "No built site: run make site"; exit 1; }
if grep -q '{{SUPPORT_EMAIL}}' "$SITE/index.html" "$SITE/privacy.html"; then
  echo "SUPPORT_EMAIL is not set in .env: refusing to publish a page without a contact"; exit 1
fi
rsync -az --delete --exclude CNAME --exclude .nojekyll "$SITE/" "$HOST:$DEST"
echo "Published to $HOST:$DEST (https://desksync.org)"
