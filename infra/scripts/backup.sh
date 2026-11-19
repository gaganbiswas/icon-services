#!/usr/bin/env bash
# Encrypted PostgreSQL backup (Phase 11, docs/deployment-runbook.md).
#
#   DATABASE_URL     source database (required)
#   BACKUP_DIR       output directory (required)
#   BACKUP_CERT      PEM certificate of the backup recipient (required). Only the matching private key —
#                    kept OFFLINE, not on the backup host — can decrypt (CMS, AES-256-GCM, authenticated).
#   RETENTION_DAYS   delete encrypted backups older than this (default 35)
#   PG_DUMP          pg_dump command (default: pg_dump; must match the server major version)
#
# The plaintext dump is never written to disk: pg_dump streams into openssl.
set -euo pipefail
umask 077

: "${DATABASE_URL:?set DATABASE_URL}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${BACKUP_CERT:?set BACKUP_CERT (recipient certificate)}"
RETENTION_DAYS="${RETENTION_DAYS:-35}"
read -r -a PG_DUMP_CMD <<<"${PG_DUMP:-pg_dump}"

[[ -r "$BACKUP_CERT" ]] || { echo "backup: certificate not readable" >&2; exit 2; }
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/icon-$stamp.dump.cms"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

"${PG_DUMP_CMD[@]}" --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" \
  | openssl cms -encrypt -binary -stream -aes-256-gcm -outform DER -out "$tmp" "$BACKUP_CERT"
mv "$tmp" "$out"
trap - EXIT

checksum="$(openssl dgst -sha256 -r "$out" | cut -d' ' -f1)"
printf '%s  %s\n' "$checksum" "$(basename "$out")" >"$out.sha256"
echo "backup: wrote $(basename "$out") ($(wc -c <"$out" | tr -d ' ') bytes)"

# Retention: only our own encrypted files and their checksums.
find "$BACKUP_DIR" -maxdepth 1 -type f \( -name 'icon-*.dump.cms' -o -name 'icon-*.dump.cms.sha256' \) \
  -mtime "+$RETENTION_DAYS" -print -delete | sed 's/^/backup: removed old /'
