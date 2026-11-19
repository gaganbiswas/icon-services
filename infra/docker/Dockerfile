# syntax=docker/dockerfile:1.7
# Production images (Phase 12, ADR 0020). Build from the repository root:
#   docker build -f infra/docker/Dockerfile --target api   -t icon/api   .
#   docker build -f infra/docker/Dockerfile --target web   -t icon/web   --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com .
#   docker build -f infra/docker/Dockerfile --target edge  -t icon/edge  --build-arg VITE_API_BASE_URL=… --build-arg VITE_CUSTOMER_PORTAL_URL=… .
# Base images are pinned; update them deliberately (docs/production/operations.md).

ARG NODE_IMAGE=node:24.22.1-bookworm-slim
ARG BUN_IMAGE=oven/bun:1.4.4-slim
ARG CADDY_IMAGE=caddy:2.11.6-alpine

FROM ${BUN_IMAGE} AS bun

# ---------------------------------------------------------------- build
FROM ${NODE_IMAGE} AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx \
 # OpenSSL lets Prisma pick the engine matching the runtime image (OpenSSL 3).
 && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV TURBO_TELEMETRY_DISABLED=1 NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY . .
RUN bun install --frozen-lockfile --filter '@icon/api' --filter '@icon/web' --filter '@icon/admin' \
      --filter '@icon/database' --filter '@icon/contracts' --filter '@icon/config'
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
ARG VITE_API_BASE_URL=http://localhost:4000
ARG VITE_CUSTOMER_PORTAL_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    VITE_API_BASE_URL=${VITE_API_BASE_URL} \
    VITE_CUSTOMER_PORTAL_URL=${VITE_CUSTOMER_PORTAL_URL}
RUN bunx turbo run build --filter=@icon/api --filter=@icon/web --filter=@icon/admin

# ---------------------------------------------------------------- api (+ worker, migrations, CLI)
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build --chown=node:node /app /app
# Headless Chromium for server-side PDFs (JavaScript disabled, network blocked; ADR 0012).
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
 && node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
 && rm -rf /var/lib/apt/lists/* \
 && chmod -R a+rX /ms-playwright \
 && rm -rf apps/web apps/admin/src /root/.bun
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/main.js"]

# ---------------------------------------------------------------- customer portal (Next.js standalone)
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------- edge: Caddy (TLS) + staff panel static files
FROM ${CADDY_IMAGE} AS edge
COPY --from=build /app/apps/admin/dist /srv/admin
COPY deploy/production/Caddyfile /etc/caddy/Caddyfile
