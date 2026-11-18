# ICON INFOSYS SERVICE MANAGEMENT

Service-centre management system for computer hardware repair: complaint intake,
diagnosis, estimates and customer approval, repair, GST / non-GST invoicing,
payments, delivery challan, and WhatsApp/email notifications.

Project rules: [`CLAUDE.md`](CLAUDE.md). Decisions: [`docs/decisions/`](docs/decisions/README.md).
Open owner questions: [`docs/owner-questions.md`](docs/owner-questions.md).

> **Status:** Phase 1 (monorepo foundation). No business features yet.

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
cp .env.example .env          # local-only placeholder values
bun install
bun run services:up           # PostgreSQL :5433, Redis :6380, S3 :8333 (localhost only)
bun run build
bun run dev                   # API :4000, admin :5173, web :3000, Expo (Metro)
```

Run a single app: `bunx turbo run dev --filter=@icon/api` (or `@icon/admin`, `@icon/web`, `@icon/mobile`).

Health checks: `GET http://localhost:4000/api/v1/health/live` and `/health/ready`.
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

CI: `.github/workflows/ci.yml` (GitHub Actions).
