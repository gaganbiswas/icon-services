# 0002 — Database: PostgreSQL

- **Status:** Approved
- **Date:** 2026-11-18
- **Approved by:** Project owner

## Context

`CLAUDE.md` §3 and §6 specify PostgreSQL; the owner confirmed it.

## Decision

- PostgreSQL is the single system-of-record database.
- Local development and CI: PostgreSQL **17** (`postgres:17-alpine`) in Docker
  Compose — widely offered by managed hosts. Production host must run the same
  major version.
- Schema and migrations via Prisma (`packages/database`). No manual production
  schema edits.
- UUID primary keys, UTC `timestamptz` timestamps, foreign keys, constraints
  and indexes as in `CLAUDE.md` §6.
- Clients (web, mobile) never connect to PostgreSQL directly; only the API.

## Consequences

- Production host must provide managed PostgreSQL (or self-managed) with
  encrypted backups and point-in-time recovery — host not yet selected (0007).

## Alternatives considered

None — owner decision.
