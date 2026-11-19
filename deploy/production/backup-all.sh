#!/usr/bin/env bash
# Daily production backup (Phase 12; RPO 24 h, ADR 0020): encrypted database dump +
# encrypted archive of stored files, then an optional off-site copy.
# Run from the repository checkout on the server, as root (systemd timer below).
#   BACKUP_DIR=/var/backups/icon BACKUP_CERT=/etc/icon/backup-recipient.pem ENV_FILE=/etc/icon/production.env
#   [COMPOSE_ENV_FILE=deploy/production/.env]
#   OFFSITE_COMMAND='rclone copy /var/backups/icon offsite:icon-backups'   # optional, must be in India (ADR 0020)
set -euo pipefail
umask 077
: "${BACKUP_DIR:?}" "${BACKUP_CERT:?}" "${ENV_FILE:?}"
cd "$(dirname "$0")/../.."
compose=(docker compose -f deploy/production/compose.yml --env-file "${COMPOSE_ENV_FILE:-deploy/production/.env}")
export ENV_FILE

# 1. Database (plaintext never touches disk).
PG_DUMP="${compose[*]} exec -T postgres pg_dump -U icon" DATABASE_URL="postgresql:///icon_service" \
  BACKUP_DIR="$BACKUP_DIR" BACKUP_CERT="$BACKUP_CERT" RETENTION_DAYS="${RETENTION_DAYS:-35}" infra/scripts/backup.sh

# 2. Stored files (photos, issued documents) from the storage volume, streamed and encrypted.
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
files="$BACKUP_DIR/icon-files-$stamp.tar.cms"
volume="${S3_VOLUME:-icon_s3-data}"
docker volume inspect "$volume" >/dev/null
docker run --rm -v "$volume:/data:ro" alpine:3.22 tar -C /data -cf - . \
  | openssl cms -encrypt -binary -stream -aes-256-gcm -outform DER -out "$files.partial" "$BACKUP_CERT"
mv "$files.partial" "$files"
openssl dgst -sha256 -r "$files" | sed "s# .*#  $(basename "$files")#" >"$files.sha256"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'icon-files-*' -mtime "+${RETENTION_DAYS:-35}" -delete
echo "backup: wrote $(basename "$files")"

# 3. Off-site copy (another location in India).
if [[ -n "${OFFSITE_COMMAND:-}" ]]; then
  bash -c "$OFFSITE_COMMAND"
  echo "backup: off-site copy done"
else
  echo "backup: WARNING no OFFSITE_COMMAND configured — backups exist only on this server" >&2
fi
touch "$BACKUP_DIR/.last-success"
