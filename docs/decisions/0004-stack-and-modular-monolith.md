# 0004 — Application stack and modular monolith

- **Status:** Approved (owner approved Phase 1 start on this stack, 2026-11-18; amended by ADR 0008/0009)
- **Date:** 2026-11-18

## Decision

| Concern            | Choice                                                                 |
|--------------------|------------------------------------------------------------------------|
| Monorepo           | Bun workspaces + Turborepo (0001)                                      |
| Language           | TypeScript, `strict: true`, no implicit `any`                          |
| API                | NestJS, REST under `/api/v1`, OpenAPI generated from controllers/DTOs  |
| Staff admin panel  | Vite + React + TanStack Router SPA (`apps/admin`, ADR 0008)            |
| Customer portal    | Next.js 16 App Router (`apps/web`, ADR 0008)                           |
| Android            | React Native with Expo (Android first; no iOS in release one)          |
| Database / ORM     | PostgreSQL (0002) + Prisma migrations                                  |
| Background jobs    | Redis + BullMQ; transactional outbox table in PostgreSQL               |
| File storage       | S3-compatible; SeaweedFS locally (ADR 0009)                            |
| Auth               | Short-lived access JWT + rotating refresh tokens (reuse detection), Argon2id |
| Validation         | Zod everywhere (shared in `packages/contracts`, used at API boundary via a Zod validation pipe) — one library, no conflicting rules |
| PDFs               | Server-side rendering (library to be chosen in Phase 3; candidates: Playwright/Chromium HTML→PDF or pdfmake) |
| Tests              | Vitest + Testing Library (contracts, admin, web), Vitest + SWC + Supertest (NestJS API — NestJS 12 is ESM-only, which Jest handles poorly), Playwright (web E2E, from Phase 3), Jest (`jest-expo`) + React Native Testing Library (mobile) |
| Architecture       | Modular monolith; one deployable API + one worker process from the same codebase. No microservices. |

API domain modules are those listed in `CLAUDE.md` §3.

## Rationale

Matches `CLAUDE.md` §3. Zod is chosen over class-validator so the same
schemas are shared by web, mobile and API (avoids duplicated/conflicting rules).
