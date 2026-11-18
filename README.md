# ICON INFOSYS SERVICE MANAGEMENT

Service-centre management system for computer hardware repair: complaint intake,
diagnosis, estimates and customer approval, repair, GST / non-GST invoicing,
payments, delivery challan, and WhatsApp/email notifications.

Project rules: [`CLAUDE.md`](CLAUDE.md). Decisions: [`docs/decisions/`](docs/decisions/README.md).
Open owner questions: [`docs/owner-questions.md`](docs/owner-questions.md).

> **Status:** Phase 5 complete — versioned estimates and customer approval (Android app or single-use link on the
> customer website). Inventory starts in Phase 6. Tax is not calculated until the accountant confirms configuration.

## Repository layout

| Path | What | Tech |
|------|------|------|
| `apps/api` | REST API `/api/v1` + background worker (later) | NestJS 12 on Node.js 24 LTS |
| `apps/admin` | Staff admin panel (all staff roles) | Vite + React 19 + TanStack Router |
| `apps/web` | Customer web portal | Next.js 16 |
| `apps/mobile` | Android customer app | Expo SDK 58 / React Native 0.88 |
| `packages/contracts` | Shared Zod schemas and types | Zod 4 |
| `packages/database` | Prisma schema and migrations | Prisma 7, PostgreSQL 17 |
| `packages/config` | Shared TypeScript / ESLint config | — |
| `docs/` | Requirements, architecture, threat model, ADRs | — |

## Prerequisites

- **Bun 1.4.4** — the only package manager (do not use npm/pnpm/yarn).
- **Node.js 24 LTS** — runtime for the API, Next.js and Expo tooling (`.nvmrc`).
- **Docker** — local PostgreSQL, Redis and SeaweedFS (S3).

## Getting started

```sh
cp .env.example .env          # local-only placeholders — set JWT_ACCESS_SECRET and SEED_ADMIN_PASSWORD
bun install
bun run services:up           # PostgreSQL :5433, Redis :6380, S3 :8333 (localhost only)
node node_modules/playwright-core/cli.js install --only-shell chromium   # PDF receipts (one-time)
bun run build
bun run db:migrate            # apply Prisma migrations to the dev database
bun run db:seed:dev           # dev-only: placeholder org/branch + Super Admin from SEED_ADMIN_*
bun run dev                   # API :4000, admin :5173, web :3000, Expo (Metro)
```

Estimates require the business currency: `PUT /api/v1/settings/money` with `{"value":{"currency":"<ISO code>"},"reason":"…"}`
(not assumed — owner question B11). Approval links open on the customer website (`apps/web`, http://localhost:3000/estimate).

Notifications are sent by a separate worker process (mock WhatsApp/email providers until Phase 10):
`bun run --filter @icon/api build && bun run --filter @icon/api start:worker`.

Sign in to the admin panel at http://localhost:5173 with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
New staff are created via `POST /api/v1/users`; the response contains a one-time set-up token, used at
`http://localhost:5173/set-password#token=<token>` (the token stays in the URL fragment, never sent to servers).

Android app: copy `apps/mobile/.env.example` to `apps/mobile/.env` and run `bunx turbo run dev --filter=@icon/mobile`.
Customer sign-in uses a **development-only mock OTP provider**: the 6-digit code is printed in the API console.
A real SMS/WhatsApp OTP provider is still an owner decision (questions E42/F45).

Integration tests use a separate database (`TEST_DATABASE_URL`, name must end in `_test`), created
automatically for new Docker volumes. For an existing volume:
`docker compose exec postgres psql -U icon -d icon_service -c 'CREATE DATABASE icon_service_test'`.

Run a single app: `bunx turbo run dev --filter=@icon/api` (or `@icon/admin`, `@icon/web`, `@icon/mobile`).

Health checks: `GET http://localhost:4000/api/v1/health/live` and `/health/ready`.
API reference: [`docs/api-specification.md`](docs/api-specification.md). Schema: [`docs/database-dictionary.md`](docs/database-dictionary.md).
OpenAPI docs: http://localhost:4000/api/docs (when `API_DOCS_ENABLED=true`).

## Quality commands

| Command | Does |
|---------|------|
| `bun run check` | Format check + lint + typecheck + unit tests + build (everything CI runs except integration/security) |
| `bun run lint` / `typecheck` / `test` / `build` | Individual Turborepo tasks |
| `bun run test:integration` | API tests against real PostgreSQL/Redis (needs `services:up`) |
| `bun run format` | Prettier write |
| `bun run audit` | Dependency audit (policy: `docs/security/dependency-audit.md`) |
| `bun run services:down` | Stop local services (data volumes are kept) |
| `bun run db:migrate` / `db:deploy` / `db:status` | Prisma migrations (dev / apply / status) |
| `bun run db:seed:dev` | Development seed (refuses `NODE_ENV=production`) |

CI: `.github/workflows/ci.yml` (GitHub Actions).
