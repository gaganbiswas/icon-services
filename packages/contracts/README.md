# @icon/contracts

Shared Zod schemas, enums and TypeScript types used by `apps/api`, `apps/admin`,
`apps/web` and `apps/mobile`. One source of validation rules (ADR 0004).

Rules: no secrets, no Prisma/NestJS/React imports, no business logic.
Built to `dist/` (ESM) — Turborepo builds it before dependants.
