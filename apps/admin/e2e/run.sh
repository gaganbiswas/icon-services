#!/usr/bin/env bash
# Prepares an isolated E2E database with the UAT role users, then runs Playwright.
# Requires: services up (bun run services:up), API built (bun run build), .env present.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
base_url="${DATABASE_URL:-$(grep '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2-)}"
# Same server and credentials, dedicated database name.
export E2E_DATABASE_URL="$(sed -E 's#/[^/?]+(\?|$)#/icon_service_e2e\1#' <<<"$base_url")"
[[ "$E2E_DATABASE_URL" == *icon_service_e2e* ]] || { echo "e2e: could not derive the E2E database URL" >&2; exit 2; }
# Recreate only the dedicated E2E database (name checked above).
if command -v psql >/dev/null 2>&1; then
  admin_url="$(sed -E 's#/icon_service_e2e(\?.*)?$#/postgres#' <<<"$E2E_DATABASE_URL")"
  psql "$admin_url" -qc "DROP DATABASE IF EXISTS icon_service_e2e" -c "CREATE DATABASE icon_service_e2e" >/dev/null
else
  docker compose exec -T postgres psql -U icon -d icon_service -qc "DROP DATABASE IF EXISTS icon_service_e2e" -c "CREATE DATABASE icon_service_e2e" >/dev/null
fi
(cd packages/database && DATABASE_URL="$E2E_DATABASE_URL" bunx prisma migrate deploy >/dev/null)
export UAT_PASSWORD="${UAT_PASSWORD:-E2e-$(openssl rand -hex 12)}"
(cd packages/database && DATABASE_URL="$E2E_DATABASE_URL" node dist/seed/uat.js)
cd apps/admin && bunx playwright test "$@"
