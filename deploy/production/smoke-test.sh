#!/usr/bin/env bash
# Post-deployment smoke test (Phase 12). Read-only: creates no data.
#   ADMIN_DOMAIN=staff.example.com API_DOMAIN=api.example.com PORTAL_DOMAIN=service.example.com \
#   FILES_DOMAIN=files.example.com deploy/production/smoke-test.sh
# SMOKE_INSECURE=1 accepts a locally issued (internal CA) certificate — local tests only.
set -uo pipefail
: "${ADMIN_DOMAIN:?}" "${API_DOMAIN:?}" "${PORTAL_DOMAIN:?}" "${FILES_DOMAIN:?}"
CURL=(curl -sS --max-time 15)
[[ "${SMOKE_INSECURE:-0}" == "1" ]] && CURL+=(-k)
failures=0
check() { # name, condition-result
  if [[ "$2" == "ok" ]]; then printf '  PASS  %s\n' "$1"; else printf '  FAIL  %s (%s)\n' "$1" "$2"; failures=$((failures + 1)); fi
}
status() { "${CURL[@]}" -o /dev/null -w '%{http_code}' "$@" 2>/dev/null; }
header() { "${CURL[@]}" -o /dev/null -D - "$1" 2>/dev/null | tr -d '\r' | grep -i "^$2:" | head -1 | cut -d' ' -f2-; }
is() { [[ "$1" == "$2" ]] && echo ok || echo "got '$1', want '$2'"; }
has() { [[ -n "$1" ]] && echo ok || echo missing; }

echo "Smoke test: staff=$ADMIN_DOMAIN api=$API_DOMAIN portal=$PORTAL_DOMAIN files=$FILES_DOMAIN"
check "API liveness" "$(is "$(status "https://$API_DOMAIN/api/v1/health/live")" 200)"
check "API readiness (database, Redis, storage)" "$(is "$(status "https://$API_DOMAIN/api/v1/health/ready")" 200)"
check "API docs disabled" "$(is "$(status "https://$API_DOMAIN/api/docs")" 404)"
check "Unauthenticated API call refused" "$(is "$(status "https://$API_DOMAIN/api/v1/jobs")" 401)"
check "Wrong password refused" "$(is "$(status -X POST -H 'Content-Type: application/json' -d '{"email":"nobody@example.invalid","password":"wrong-password"}' "https://$API_DOMAIN/api/v1/auth/login")" 401)"
check "Staff panel served" "$(is "$(status "https://$ADMIN_DOMAIN/")" 200)"
check "Staff panel deep link (SPA fallback)" "$(is "$(status "https://$ADMIN_DOMAIN/jobs")" 200)"
check "Staff panel CSP" "$(has "$(header "https://$ADMIN_DOMAIN/" content-security-policy)")"
check "Staff panel frame protection" "$(is "$(header "https://$ADMIN_DOMAIN/" x-frame-options)" DENY)"
check "Customer portal served" "$(is "$(status "https://$PORTAL_DOMAIN/")" 200)"
check "HSTS on portal" "$(has "$(header "https://$PORTAL_DOMAIN/" strict-transport-security)")"
check "HSTS on API" "$(has "$(header "https://$API_DOMAIN/api/v1/health/live" strict-transport-security)")"
check "HTTP redirects to HTTPS" "$(is "$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "http://$PORTAL_DOMAIN/")" 308)"
preflight="$("${CURL[@]}" -o /dev/null -D - -X OPTIONS -H "Origin: https://$ADMIN_DOMAIN" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type,idempotency-key' "https://$API_DOMAIN/api/v1/jobs" | tr -d '\r' | grep -i '^access-control-allow-headers:' | tr 'A-Z' 'a-z')"
check "CORS allows the staff panel (incl. Idempotency-Key)" "$([[ "$preflight" == *idempotency-key* ]] && echo ok || echo "$preflight")"
check "File domain refuses uploads" "$(is "$(status -X PUT "https://$FILES_DOMAIN/icon-files/probe")" 405)"
check "File domain refuses unsigned reads" "$(is "$(status "https://$FILES_DOMAIN/icon-files/probe")" 403)"
if [[ "${SMOKE_INSECURE:-0}" != "1" ]]; then
  expiry="$(echo | openssl s_client -connect "$PORTAL_DOMAIN:443" -servername "$PORTAL_DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null)"
  check "Trusted TLS certificate" "$(has "$expiry")"
fi
if [[ "${SMOKE_FROM_OUTSIDE:-0}" == "1" ]]; then
  for port in 5432 6379 8333 4000 3000; do
    if (exec 3<>"/dev/tcp/$API_DOMAIN/$port") 2>/dev/null; then check "Port $port closed to the internet" "open"; else check "Port $port closed to the internet" ok; fi
  done
fi
echo "$failures failure(s)"
exit $(( failures > 0 ))
