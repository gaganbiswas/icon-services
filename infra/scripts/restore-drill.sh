#!/usr/bin/env bash
# Restore drill (Phase 11): decrypts a backup, restores it into an EMPTY scratch database and verifies it.
#
#   BACKUP_FILE        encrypted backup (icon-*.dump.cms) with its .sha256 next to it (required)
#   BACKUP_KEY         PEM private key of the backup recipient (required; bring it from offline storage)
#   DRILL_DATABASE_URL scratch database to restore into (required). Its name must contain "drill" and it
#                      must be empty — the drill refuses to touch anything else.
#   SOURCE_DATABASE_URL optional: when set, per-table row counts are compared with the source. Use only on a
#                      quiet source (or a copy) — live writes after the backup cause expected differences.
#   PG_RESTORE / PSQL  commands (defaults: pg_restore / psql)
#
# Exit code 0 = drill passed. Record the result in the runbook's drill log.
set -euo pipefail
umask 077

: "${BACKUP_FILE:?set BACKUP_FILE}"
: "${BACKUP_KEY:?set BACKUP_KEY}"
: "${DRILL_DATABASE_URL:?set DRILL_DATABASE_URL}"
read -r -a PG_RESTORE_CMD <<<"${PG_RESTORE:-pg_restore}"
read -r -a PSQL_CMD <<<"${PSQL:-psql}"

db_name="${DRILL_DATABASE_URL##*/}"
db_name="${db_name%%\?*}"
[[ "$db_name" == *drill* ]] || { echo "drill: refusing: database name '$db_name' does not contain 'drill'" >&2; exit 2; }

sql() { "${PSQL_CMD[@]}" --dbname="$1" -v ON_ERROR_STOP=1 -At -c "$2"; }

existing="$(sql "$DRILL_DATABASE_URL" "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[[ "$existing" == "0" ]] || { echo "drill: refusing: scratch database is not empty ($existing tables)" >&2; exit 2; }

echo "drill: verifying checksum"
expected="$(cut -d' ' -f1 <"$BACKUP_FILE.sha256")"
actual="$(openssl dgst -sha256 -r "$BACKUP_FILE" | cut -d' ' -f1)"
[[ "$expected" == "$actual" ]] || { echo "drill: FAILED: checksum mismatch" >&2; exit 1; }

started=$(date +%s)
# Decrypt fully BEFORE restoring: AES-GCM authenticity is only known at the end of the
# stream, so streaming into pg_restore could load tampered data before the check fails.
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
echo "drill: decrypting and authenticating"
if ! openssl cms -decrypt -binary -inform DER -in "$BACKUP_FILE" -inkey "$BACKUP_KEY" -out "$workdir/backup.dump" 2>"$workdir/openssl.err"; then
  echo "drill: FAILED: backup could not be decrypted/authenticated (wrong key or tampered file)" >&2
  exit 1
fi
echo "drill: restoring"
"${PG_RESTORE_CMD[@]}" --no-owner --no-privileges --exit-on-error --dbname="$DRILL_DATABASE_URL" <"$workdir/backup.dump"
rm -f "$workdir/backup.dump"
elapsed=$(( $(date +%s) - started ))

echo "drill: checking restored database"
migrations="$(sql "$DRILL_DATABASE_URL" "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL")"
latest="$(sql "$DRILL_DATABASE_URL" "SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1")"
triggers="$(sql "$DRILL_DATABASE_URL" "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal")"
[[ "$migrations" -gt 0 ]] || { echo "drill: FAILED: no applied migrations" >&2; exit 1; }
[[ "$triggers" -gt 0 ]] || { echo "drill: FAILED: integrity triggers missing" >&2; exit 1; }
# Append-only protection must survive the restore. The probe always rolls back (PROBE_DONE).
probe="DO \$\$ BEGIN
  INSERT INTO audit_logs (id, actor_type, action, entity_type) VALUES (gen_random_uuid(), 'SYSTEM', 'drill.probe', 'drill');
  BEGIN
    UPDATE audit_logs SET action = 'drill.changed' WHERE action = 'drill.probe';
    RAISE EXCEPTION 'APPEND_ONLY_BROKEN';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'APPEND_ONLY_BROKEN' THEN RAISE; END IF;
  END;
  RAISE EXCEPTION 'PROBE_DONE';
END \$\$;"
probe_result="$("${PSQL_CMD[@]}" --dbname="$DRILL_DATABASE_URL" -At -c "$probe" 2>&1 || true)"
[[ "$probe_result" == *PROBE_DONE* ]] || { echo "drill: FAILED: audit_logs append-only check: $probe_result" >&2; exit 1; }

counts_query="SELECT string_agg(t.tablename || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', t.tablename), false, true, '')))[1]::text, ' ' ORDER BY t.tablename) FROM pg_tables t WHERE t.schemaname = 'public'"
restored_counts="$(sql "$DRILL_DATABASE_URL" "$counts_query")"
if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  source_counts="$(sql "$SOURCE_DATABASE_URL" "$counts_query")"
  if [[ "$source_counts" != "$restored_counts" ]]; then
    echo "drill: FAILED: row counts differ from source" >&2
    diff <(tr ' ' '\n' <<<"$source_counts") <(tr ' ' '\n' <<<"$restored_counts") >&2 || true
    exit 1
  fi
  echo "drill: row counts match the source for every table"
fi

echo "drill: PASSED — $migrations migrations (latest $latest), $triggers triggers, restore took ${elapsed}s"
echo "drill: table rows: $restored_counts"
