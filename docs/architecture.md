# Architecture — ICON INFOSYS SERVICE MANAGEMENT

Status: **Updated Phase 1** — based on `CLAUDE.md` §3 and ADRs 0001–0009.

## 1. Overview

Modular monolith. One API codebase deployed as two processes (HTTP API, background
worker). Two client apps in separate folders. PostgreSQL is the single source of truth.

```text
 ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
 │ apps/admin        │ │ apps/web          │ │ apps/mobile       │
 │ React + TanStack  │ │ Next.js 16        │ │ Expo (Android)    │
 │ Router — staff    │ │ customer portal   │ │ customer app      │
 └─────────┬─────────┘ └─────────┬─────────┘ └─────────┬─────────┘
           │        HTTPS /api/v1 (JSON)               │
           └─────────────────────┬─────────────────────┘
                 ┌─────────▼──────────┐
                 │ apps/api (NestJS)  │── auth, RBAC, domain modules,
                 │ HTTP process       │   transactions, outbox writes
                 └──┬──────┬──────┬───┘
                    │      │      │
          ┌─────────▼┐ ┌───▼───┐ ┌▼──────────────┐
          │PostgreSQL│ │ Redis │ │ S3 (SeaweedFS │
          │ (Prisma) │ │BullMQ │ │ locally)      │
          └─────────▲┘ └───▲───┘ └▲──────────────┘
                    │      │      │
                 ┌──┴──────┴──────┴───┐
                 │ apps/api worker     │── outbox relay, notifications,
                 │ process             │   PDF generation, retries/DLQ
                 └─────────┬───────────┘
                           │ provider adapters
             ┌─────────────┴──────────────┐
             │ WhatsApp (official) │ Email │  (mocked until Phase 10)
             └────────────────────────────┘
```

## 2. Repository layout (Bun workspaces + Turborepo)

```text
icon-services/
  CLAUDE.md  README.md  package.json  bun.lock  bunfig.toml  turbo.json
  .env.example  docker-compose.yml  .github/workflows/ci.yml
  apps/{api,admin,web,mobile}
  packages/{database,contracts,ui,config}
  docs/  infra/{docker,scripts}
```

Dependency rules:
- `apps/*` may depend on `packages/*`; never on other `apps/*`.
- `packages/contracts` has no runtime dependency on Prisma, NestJS, React or secrets.
- `packages/database` is imported only by `apps/api`.
- `packages/ui` (created when first needed) may be imported by `apps/admin` and `apps/web` only.
- `packages/contracts` is built to `dist/` (ESM); Turborepo builds it before dependants.

## 3. API internals

- Modules per `CLAUDE.md` §3 (auth … settings). Each owns controller, service,
  repository access, Zod DTOs, permission checks, tests.
- Cross-cutting: request-ID middleware, auth guard, permission guard, branch-scope
  resolver, Zod validation pipe, idempotency interceptor, audit service,
  standard error filter (no stack traces), rate limiter.
- Transactions via Prisma interactive transactions for: intake + numbering,
  estimate versioning, invoice issue, payment allocation, stock movements,
  delivery completion, outbox writes.
- Numbering: `number_sequences` row locked with `SELECT … FOR UPDATE` inside the
  business transaction (never `MAX()+1`).
- Optimistic concurrency: `version` column on mutable aggregates.

## 4. Notifications

Domain transaction writes `notification_outbox` row → worker relays to BullMQ →
channel adapter (WhatsApp / email interface) → `notification_deliveries` updated
from provider callbacks only. Bounded retries, exponential backoff, dead-letter
queue, manual retry permission.

## 5. Documents

Server-side PDF generation in worker; stored in object storage with immutable
metadata in `documents`; downloads via short-lived signed URLs after authorization.

## 6. Environments

- Local: Docker Compose — PostgreSQL 17 (:5433), Redis 7.4 (:6380), SeaweedFS S3 (:8333), Mailpit SMTP (:1025, UI :8025), bound to 127.0.0.1.
- CI: install, lint, typecheck, unit, integration (ephemeral Postgres/Redis), E2E.
- Staging/production: one Linux VPS in India running `deploy/production/compose.yml` behind Caddy (ADR 0020, `docs/production/README.md`).

## 7. Local ports

| Service | Port |
|---------|------|
| API | 4000 |
| Admin panel (Vite) | 5173 |
| Customer portal (Next.js) | 3000 |
| PostgreSQL | 5433 |
| Redis | 6380 |
| S3 (SeaweedFS) | 8333 |

## 8. Open architectural items

- Runtime for API (ADR 0006, proposed Node.js LTS).
- PDF library selection (Phase 3).
- Customer authentication method/OTP provider (owner question E42, F45).
- ~~Desktop app requirement~~ — resolved: web only (ADR 0003).
