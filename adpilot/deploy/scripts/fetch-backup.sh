#!/usr/bin/env bash
# Downloads a database backup from the backup bucket (bundled MinIO) into ./backups/.
#   deploy/scripts/fetch-backup.sh              # latest backup
#   deploy/scripts/fetch-backup.sh <file-name>  # a specific one (see Super Admin → Backups)
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a

mkdir -p backups
NETWORK="$(docker compose ps -q minio | xargs docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}')"
MC=(docker run --rm --network "$NETWORK" -v "$PWD/backups:/backups" -e MC_HOST_local="http://${S3_ACCESS_KEY_ID}:${S3_SECRET_ACCESS_KEY}@minio:9000" minio/mc:RELEASE.2025-08-13T08-35-41Z)

BUCKET="${S3_BACKUP_BUCKET:-adpilot-backups}"
NAME="${1:-}"
if [ -z "$NAME" ]; then
  NAME="$("${MC[@]}" ls "local/${BUCKET}/backups/database/" | awk '{print $NF}' | sort | tail -n 1)"
fi
[ -n "$NAME" ] || { echo "No backups found in ${BUCKET}" >&2; exit 1; }
"${MC[@]}" cp "local/${BUCKET}/backups/database/${NAME}" "/backups/${NAME}"
echo "Downloaded backups/${NAME}"
