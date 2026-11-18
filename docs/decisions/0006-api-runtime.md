# 0006 — JavaScript runtime for API in production

- **Status:** Approved (owner answer A3, 2026-11-18)
- **Date:** 2026-11-18

## Context

Bun is approved as package manager (0001). Bun can also be a runtime, but
NestJS, Prisma, BullMQ, Argon2 (native module) and PDF tooling are primarily
developed and tested against Node.js.

## Decision

- Use **Bun** for installing dependencies and running scripts/tests where supported.
- Run the **NestJS API and worker on Node.js LTS** in development and
  production, to minimise compatibility risk for a financial system.
- Next.js and Expo/Metro also run on Node.js (required by their tooling).
- Revisit running the API on the Bun runtime later, only with a full passing
  test suite.

