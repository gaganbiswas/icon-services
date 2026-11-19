#!/usr/bin/env bash
# One-command local backup + restore drill against the Docker Compose database
# (development only; uses a throw-away key pair). Run from the repository root.
set -euo pipefail
umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"; docker compose exec -T postgres psql -U icon -d icon_service -qc "DROP DATABASE IF EXISTS icon_service_drill" >/dev/null' EXIT

openssl req -x509 -newkey rsa:3072 -nodes -keyout "$work/key.pem" -out "$work/cert.pem" -days 1 -subj "/CN=icon-local-drill" 2>/dev/null
docker compose exec -T postgres psql -U icon -d icon_service -qc "DROP DATABASE IF EXISTS icon_service_drill" -c "CREATE DATABASE icon_service_drill"

export PG_DUMP="docker compose exec -T postgres pg_dump"
export PG_RESTORE="docker compose exec -T postgres pg_restore"
export PSQL="docker compose exec -T postgres psql"

DATABASE_URL="postgresql:///icon_service?user=icon" BACKUP_DIR="$work/out" BACKUP_CERT="$work/cert.pem" \
  "$(dirname "$0")/backup.sh"
BACKUP_FILE="$(ls "$work"/out/icon-*.dump.cms)" BACKUP_KEY="$work/key.pem" \
  DRILL_DATABASE_URL="postgresql:///icon_service_drill?user=icon" SOURCE_DATABASE_URL="postgresql:///icon_service?user=icon" \
  "$(dirname "$0")/restore-drill.sh"
