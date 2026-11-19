#!/usr/bin/env bash
# Builds the production images for one environment (frontends embed their API address).
#   IMAGE_TAG=2026-11-19.1 API_DOMAIN=api.example.com PORTAL_DOMAIN=service.example.com \
#   [IMAGE_REGISTRY=registry.example.com/icon] [PLATFORM=linux/amd64] deploy/production/build-images.sh
set -euo pipefail
: "${IMAGE_TAG:?}" "${API_DOMAIN:?}" "${PORTAL_DOMAIN:?}"
registry="${IMAGE_REGISTRY:-icon}"
cd "$(dirname "$0")/../.."
# PLATFORM=linux/amd64 when building on an ARM Mac for an x86 server.
args=(${PLATFORM:+--platform "$PLATFORM"}
  --build-arg "NEXT_PUBLIC_API_BASE_URL=https://$API_DOMAIN"
  --build-arg "VITE_API_BASE_URL=https://$API_DOMAIN"
  --build-arg "VITE_CUSTOMER_PORTAL_URL=https://$PORTAL_DOMAIN"
  --label "org.opencontainers.image.revision=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
)
for target in api web edge; do
  docker build -f infra/docker/Dockerfile --target "$target" -t "$registry/$target:$IMAGE_TAG" "${args[@]}" .
done
echo "Built $registry/{api,web,edge}:$IMAGE_TAG"
