# API specification (summary)

Base path `/api/v1`. JSON. Live OpenAPI document: `GET /api/docs` (and `/api/docs-json`) when
`API_DOCS_ENABLED=true` — generated from controllers and the shared Zod contracts.
Updated: Phase 6 (2026-11-18).

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

## Phase 3 endpoints

`POST /jobs` and `POST /customer/jobs` require an **`Idempotency-Key`** header (8–100 of `A-Z a-z 0-9 _ -`).
A retry with the same key and body returns the original response (`Idempotent-Replayed: true`); the same key with a
different body → 422 `IDEMPOTENCY_KEY_REUSED`; a concurrent duplicate still in progress → 409.

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/settings` | `settings.read` | Effective settings (defaults where unset) |
| PUT | `/settings/:key` | `settings.manage` | `{value, reason}`; validated; audited |
| GET | `/customers?q=` | `customers.read` | Search name / phone / e-mail / customer code |
| POST | `/customers` | `customers.write` | Phone normalized to E.164 (country code required until a default region is set) |
| GET / PATCH | `/customers/:id` | read / write | PATCH needs `version` |
| PUT | `/customers/:id/consents` | `customers.write` | `{channel, purpose, granted}` |
| GET | `/asset-categories` | `assets.read` | |
| GET | `/customers/:id/assets` | `assets.read` | |
| POST | `/assets` | `assets.write` | Returns `duplicateSerialWarning` |
| POST | `/files` | `jobs.create` | multipart `file`, ≤ 10 MB, JPEG/PNG/WebP/HEIC/PDF by content |
| GET | `/jobs?q=&status=&branchId=&customerId=` | `jobs.read` | Branch-scoped; q matches job number, customer name/phone, serial |
| POST | `/jobs` | `jobs.create` | Idempotent intake; status `RECEIVED` |
| GET | `/jobs/:id` | `jobs.read` | |
| POST | `/jobs/:id/receipt?layout=A4\|THERMAL_80` | `jobs.read` | Signed URL (5 min) to the stored PDF; first call renders, later calls reuse |
| GET | `/jobs/:id/attachments/:fileId/url` | `jobs.read` | Signed URL |

## Phase 4 endpoints (job lifecycle, ADR 0013)

Transition rules: [`docs/job-lifecycle.md`](job-lifecycle.md) (generated from the code). Technicians without `jobs.assign`
may only change jobs assigned to them (`403 NOT_ASSIGNED`).

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/jobs?assignedToMe=true` | `jobs.read` | Technician workspace list |
| GET | `/jobs/:id/workspace` | `jobs.read` | Assignments, diagnoses, work logs (internal ones only with `jobs.internal_notes.read`), completion, allowed transitions |
| POST | `/jobs/:id/status-transitions` | `jobs.transition` | `{to, version, reason?, customerMessage?}`; errors `INVALID_TRANSITION`, `REASON_REQUIRED`, `ESTIMATE_APPROVAL_REQUIRED`, `COMPLETION_REQUIRED`, `USE_RECEIVE_ACTION`, `USE_DELIVERY_WORKFLOW`, `VERSION_CONFLICT` |
| POST | `/jobs/:id/receive` | `jobs.update` | App requests: `AWAITING_DEVICE → RECEIVED` with intake details |
| POST | `/jobs/:id/completion` | `jobs.transition` | `QUALITY_CHECK → REPAIR_COMPLETED`; repair summary + all QC items passed |
| GET | `/jobs/:id/assignable-technicians` | `jobs.assign` | Active staff with `worklogs.write` in the job's branch |
| POST | `/jobs/:id/assignments` | `jobs.assign` | `{technicianUserId, note?}` |
| DELETE | `/jobs/:id/assignments/:assignmentId?reason=` | `jobs.assign` | Ends the assignment (history kept) |
| POST | `/jobs/:id/diagnoses` | `diagnosis.write` | `internalNotes` needs `jobs.internal_notes.write` |
| POST | `/jobs/:id/work-logs` | `worklogs.write` | `visibility` INTERNAL (needs `jobs.internal_notes.write`) or CUSTOMER (notifies customer) |
| POST | `/jobs/:id/attachments` | `worklogs.write` | Attach an uploaded file |
| GET | `/notifications?status=&jobId=` | `notifications.read` | Branch-scoped notification centre |
| POST | `/notifications/:id/retry` | `notifications.retry` | FAILED/DEAD → PENDING (audited) |

## Phase 5 endpoints (estimates, ADR 0014)

Money values are decimal **strings** with 4 decimals (e.g. `"2300.0000"`); totals are always computed by the server.
Tax is not calculated (`taxNote`: "Taxes, if applicable, to be confirmed.").

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/estimates/config` | `estimates.read` | `{currency (null until configured), validityDays}` |
| GET | `/jobs/:jobId/estimates` | `estimates.read` | All versions |
| POST | `/jobs/:jobId/estimates` | `estimates.write` | New DRAFT; job must be in ESTIMATE_PREPARATION; supersedes a SENT version; `CONFIGURATION_REQUIRED` without currency; assigned technicians only (unless `jobs.assign`) |
| GET | `/estimates/:id` | `estimates.read` | |
| PUT | `/estimates/:id` | `estimates.write` | Replace draft lines; `rowVersion`; `ESTIMATE_NOT_EDITABLE` once sent |
| POST | `/estimates/:id/send` | `estimates.send` | DRAFT → SENT, job → AWAITING_CUSTOMER_APPROVAL, returns single-use approval link token **once** |
| POST | `/estimates/:id/approval-link` | `estimates.send` | New link (revokes unused ones) |
| POST | `/public/estimate-links/view` | public, rate-limited | `{token}` → customer view (does not consume) |
| POST | `/public/estimate-links/decision` | public, rate-limited | `{token, decision, termsAccepted, comment?}` — consumes the link |
| GET | `/customer/jobs/:id/estimates` | customer | Own, non-draft versions |
| POST | `/customer/estimates/:id/decision` | customer | `{decision, termsAccepted, comment?}`; errors `ESTIMATE_EXPIRED`, `ESTIMATE_ALREADY_DECIDED` |

## Phase 6 endpoints (inventory, ADR 0015)

Quantities are decimal strings (4 decimals). Stock that would fall below zero returns `409 INSUFFICIENT_STOCK` unless
`allowNegative: true` with a reason is sent by a holder of `inventory.negative_override`.

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/parts?q=&includeInactive=` | `inventory.read` | Catalogue search |
| POST / PATCH | `/parts`, `/parts/:id` | `inventory.write` | PATCH needs `version` |
| GET / POST | `/suppliers` | `inventory.read` / `inventory.write` | |
| GET | `/inventory/stock?branchId=&belowReorder=&q=` | `inventory.read` | Stock levels; `belowReorder=true` = low-stock report |
| POST | `/inventory/receipts` | `inventory.write` | `{branchId, partId, quantity, unitCost?, supplierId?, reference?}` |
| POST | `/inventory/adjustments` | `inventory.adjust` | `{…, direction, quantity, reason, allowNegative?}` |
| POST | `/inventory/transfers` | `inventory.adjust` | Requires access to both branches |
| GET | `/inventory/movements?branchId=&partId=&jobId=` | `inventory.read` | Ledger |
| GET | `/inventory/reconciliation?branchId=` | `inventory.adjust` | Rows whose totals differ from the ledger (expected `[]`) |
| GET | `/jobs/:id/parts` | `jobs.read` | |
| POST | `/jobs/:id/parts` | `worklogs.write` | `{partId, action: RESERVE|RELEASE|CONSUME|RETURN, quantity, allowNegative?, reason?}`; assigned technicians only |
| PUT | `/jobs/:id/parts/removed` | `worklogs.write` | Removed/defective part description, serial, disposition |

### Customer API (customer access token; identity from token only)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/customer/auth/otp/request` | `{organizationCode, phone}` → always `{sent: true}`; rate-limited; resend interval and hourly cap |
| POST | `/customer/auth/otp/verify` | `{organizationCode, phone, code, fullName?}` → tokens; `PROFILE_REQUIRED` for new numbers; `ACCOUNT_AMBIGUOUS` if several customers share the number |
| POST | `/customer/auth/refresh`, `/customer/auth/logout` | `{refreshToken}` in body; rotation with reuse detection |
| GET | `/customer/me`, `/customer/branches`, `/customer/asset-categories`, `/customer/assets` | Own data only |
| GET | `/customer/jobs`, `/customer/jobs/:id` | Customer-safe view (customer status labels, no internal fields) |
| POST | `/customer/jobs` | Idempotent complaint → job `AWAITING_DEVICE`; warranty claim never trusted (`WARRANTY_UNVERIFIED`) |
| POST | `/customer/jobs/:id/receipt` | Own jobs only |
| POST | `/customer/files` | Customer photo upload |
| PUT | `/customer/consents` | Own consent |

## Escalation rules (enforced server-side)

An actor can only assign roles whose permissions they hold, grant branches they can access, manage users whose
permissions are a subset of their own, and cannot change their own roles, branches or active status.
