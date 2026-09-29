#!/usr/bin/env bash
# Restores a pg_dump (custom format) backup into the compose PostgreSQL database.
#   deploy/scripts/restore-db.sh backups/adpilot-db-2026-09-28T03-00-00-000Z.dump
#
# The application services are stopped during the restore. The same ENCRYPTION_KEYS that were active when the
# backup was taken must be configured, otherwise stored Meta tokens and secrets cannot be decrypted.
set -euo pipefail
cd "$(dirname "$0")/../.."
DUMP="${1:?usage: restore-db.sh <dump-file>}"
[ -f "$DUMP" ] || { echo "File not found: $DUMP" >&2; exit 1; }
set -a; . ./.env; set +a
DB="${POSTGRES_DB:-adpilot}"
DB_USER="${POSTGRES_USER:-adpilot}"

read -r -p "This REPLACES database '${DB}' with ${DUMP}. Type the database name to continue: " CONFIRM
[ "$CONFIRM" = "$DB" ] || { echo "Aborted."; exit 1; }

docker compose stop api worker scheduler
docker compose exec -T postgres psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE IF EXISTS \"${DB}\";" \
  -c "CREATE DATABASE \"${DB}\" OWNER \"${DB_USER}\";"
docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB" --no-owner --no-privileges --exit-on-error < "$DUMP"
# Apply migrations that are newer than the backup, then start the platform again.
docker compose run --rm migrate
docker compose up -d api worker scheduler
echo "Restore complete."
