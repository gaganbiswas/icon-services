# API specification (summary)

Base path `/api/v1`. JSON. Live OpenAPI document: `GET /api/docs` (and `/api/docs-json`) when
`API_DOCS_ENABLED=true` — generated from controllers and the shared Zod contracts.
Updated: Phase 2 (2026-11-18).

## Conventions

- **Auth:** `Authorization: Bearer <access token>` on every route except those marked public.
  Refresh token in HttpOnly cookie `icon_rt` (path `/api/v1/auth`). See ADR 0010.
- **CSRF:** `POST /auth/refresh` and `/auth/logout` require header `X-ICON-CSRF: 1`; `Origin` must be allow-listed.
- **Errors:** `{ "error": { "code", "message", "requestId", "details"?: [{ "path", "message" }] } }`.
  Codes: `VALIDATION_FAILED` 400, `UNAUTHENTICATED`/`INVALID_CREDENTIALS`/`INVALID_TOKEN` 401,
  `FORBIDDEN`/`PASSWORD_CHANGE_REQUIRED`/`CSRF_REJECTED` 403, `NOT_FOUND` 404, `CONFLICT`/`VERSION_CONFLICT` 409,
  `RATE_LIMITED` 429, `INTERNAL_ERROR` 500. No stack traces or driver messages.
- **Not found vs forbidden:** records in another organization or outside your branch scope return **404**.
  Malformed IDs also return 404.
- **Pagination:** `?page=1&pageSize=25` (max 100) → `{ items, page, pageSize, total }`.
- **Concurrency:** `PATCH` bodies include `version`; stale versions → 409 `VERSION_CONFLICT`.
- **Request ID:** `X-Request-Id` response header (a safe caller-supplied value is echoed).
- **Rate limits:** sign-in, password change and password set-up: `AUTH_RATE_LIMIT_PER_MINUTE` per IP (default 10).

## Endpoints

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/health/live` | public | Liveness |
| GET | `/health/ready` | public | 200/503 with `{database, redis}` |
| POST | `/auth/login` | public, rate-limited | `{email, password}` → access token + cookie. Generic error for all failures; lockout after N failures |
| POST | `/auth/refresh` | public + CSRF | Rotates cookie; reuse of a used token revokes the session |
| POST | `/auth/logout` | public + CSRF | Idempotent; 204 |
| POST | `/auth/password/change` | authenticated | `{currentPassword, newPassword}`; signs out other sessions |
| POST | `/auth/password-setup/complete` | public, rate-limited | `{token, newPassword}`; one-time token; revokes all sessions |
| GET | `/me` | authenticated | Profile, roles, effective permissions, branch access |
| GET | `/users` | `users.read` | Org + branch scoped, paginated |
| GET | `/users/:id` | `users.read` | |
| POST | `/users` | `users.manage` | `{email, fullName, roleIds, branchIds}` → user + one-time password set-up token (shown once) |
| PATCH | `/users/:id` | `users.manage` | `{version, fullName?, isActive?, roleIds?, branchIds?, reason?}`; reason required to deactivate |
| POST | `/users/:id/password-setup` | `users.manage` | Issues a new one-time token; supersedes earlier ones |
| GET | `/permissions` | `roles.read` | Catalogue |
| GET | `/roles` | `roles.read` | Roles with permissions |
| POST | `/roles` | `roles.manage` | Custom role; permissions ⊆ actor's |
| PATCH | `/roles/:id` | `roles.manage` | `{version, reason, name?, description?, permissions?}`; Super Admin permissions locked |
| GET | `/branches`, `/branches/:id` | `branches.read` | Branch-scoped |
| GET | `/audit-logs` | `audit.read` | Filters: `entityType`, `entityId`, `actorUserId`, `action`; branch-scoped |

## Escalation rules (enforced server-side)

An actor can only assign roles whose permissions they hold, grant branches they can access, manage users whose
permissions are a subset of their own, and cannot change their own roles, branches or active status.
