# @icon/database

Prisma schema and migrations for PostgreSQL 17 (ADR 0002). Only `apps/api`
may depend on this package; clients never connect to the database.

Phase 1 contains configuration only. Phase 2 adds models, the first migration,
the generated client and the development seed.

- `bun run db:validate` — validate the schema.
- `bun run db:format` — format the schema.
