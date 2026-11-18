# @icon/api

NestJS 12 REST API (ESM) for ICON INFOSYS SERVICE MANAGEMENT. Runs on Node.js
LTS (ADR 0006). Base path `/api/v1`.

| Script | Purpose |
|--------|---------|
| `bun run dev` | Watch mode (loads repo-root `.env` outside production) |
| `bun run build` / `bun run start` | Compile to `dist/` and run |
| `bun run test` | Unit + HTTP tests with mocked dependencies |
| `bun run test:integration` | Tests against real PostgreSQL/Redis (`bun run services:up` first) |

Endpoints so far:

- `GET /api/v1/health/live` — liveness.
- `GET /api/v1/health/ready` — readiness (PostgreSQL, Redis); 503 when any is down.
  Object-storage readiness is added in Phase 3 with the file-storage module.
- `GET /api/docs` — OpenAPI UI, only when `API_DOCS_ENABLED=true`.

Environment variables are validated at start-up (`src/config/env.ts`); the API
refuses to start with invalid configuration and never prints secret values.
