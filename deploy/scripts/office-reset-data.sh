#!/usr/bin/env bash
# Clears ALL Envo data on the office server for a fresh start, keeping only configuration:
# packages, system settings and the database schema. Afterwards the app prints a one-time setup link
# that creates the first platform admin.
#
# Run as the app user (asks for the sudo password once):   bash ~/envo-reset-data.sh
# Take a backup first:  sudo -u postgres pg_dump -Fc envo > ~/envo-backups/<date>/envo-db.dump
set -euo pipefail

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null

echo "This permanently deletes every customer, user, SIP server, extension, trunk, number,"
echo "call record, recording, voicemail, invoice and payment in Envo."
read -r -p 'Type WIPE to continue: ' answer
[ "$answer" = "WIPE" ] || { echo "Nothing changed."; exit 1; }

sudo -v
pm2 stop envo >/dev/null
echo "[reset] app stopped"

sudo -u postgres psql -d envo -v ON_ERROR_STOP=1 -q <<'SQL'
-- Everything people created. Kept: packages, settings, schema_migrations.
TRUNCATE accounts, subscriptions, invoices, payments, users, email_tokens, email_log,
         tenants, extensions, trunks, numbers, outbound_routes, sounds, ivrs, ring_groups, queues,
         time_conditions, blocked_numbers, conferences, api_keys, webhooks, webhook_deliveries,
         cdr, audit_log CASCADE;
SQL
echo "[reset] database cleared ($(sudo -u postgres psql -d envo -Atc 'SELECT count(*) FROM packages') packages kept)"

sudo asterisk -rx 'database deltree envo' >/dev/null || true
sudo find /var/lib/asterisk/sounds/envo /var/spool/asterisk/monitor/envo /var/lib/envo/uploads -mindepth 1 -delete 2>/dev/null || true
sudo find /var/spool/asterisk/voicemail -mindepth 1 -maxdepth 1 -type d -name 't[0-9]*' -exec rm -rf {} + 2>/dev/null || true
echo "[reset] recordings, voicemail, sounds and uploads removed"

pm2 start envo >/dev/null
for _ in $(seq 1 30); do
  [ -s /var/lib/envo/setup-url.txt ] && break
  sleep 1
done
echo
if [ -s /var/lib/envo/setup-url.txt ]; then
  echo "Done. Create the platform admin here (one-time link):"
  cat /var/lib/envo/setup-url.txt
else
  echo "Done, but no setup link yet; check: pm2 logs envo --lines 30"
fi
