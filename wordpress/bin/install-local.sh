#!/usr/bin/env bash
# First run of the local WordPress site (make wp-install). Safe to re-run.
# Fills Settings -> DeskSync from .env (make passes the values in).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

wp() { docker compose run --rm -T cli wp "$@"; }

until docker compose exec -T wordpress test -f /var/www/html/wp-config.php; do sleep 1; done

if ! wp core is-installed 2>/dev/null; then
	wp core install --url=http://localhost:8120 --title=DeskSync \
		--admin_user=admin --admin_password=password --admin_email=admin@example.com --skip-email
fi
wp theme activate desksync
wp plugin delete akismet hello 2>/dev/null || true
wp eval-file wp-content/desksync-bin/seed.php

SETTINGS=$(python3 -c 'import json,os; print(json.dumps({k.lower(): os.environ.get(k, "") for k in ("SUPABASE_URL","SUPABASE_ANON_KEY","STORE_URL","SUPPORT_EMAIL")}))')
wp option update desksync_settings "$SETTINGS" --format=json

echo
echo "Ready: http://localhost:8120"
echo "Admin: http://localhost:8120/wp-admin  (admin / password)"
