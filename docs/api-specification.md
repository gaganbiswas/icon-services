# API specification (summary)

Base path `/api/v1`. JSON. Live OpenAPI document: `GET /api/docs` (and `/api/docs-json`) when
`API_DOCS_ENABLED=true` — generated from controllers and the shared Zod contracts.
Updated: Phase 7 (2026-11-19).

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

## Phase 8 endpoints (payments, ADR 0016)

Payments sit on the customer's account until invoices exist (Phase 7). `CONFIGURATION_REQUIRED` until a currency is set.
References that look like card numbers are rejected.

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| POST | `/payments` | `payments.record` | `Idempotency-Key` required; `{branchId, customerId, jobId?, amount, method, reference?, receivedAt?, notes?}` |
| GET | `/payments?customerId=&jobId=&branchId=` | `payments.read` | Branch-scoped |
| GET | `/payments/:id` | `payments.read` | |
| POST | `/payments/:id/refunds` | `payments.refund` | `{amount, method, reference?, reason}`; `REFUND_EXCEEDS_BALANCE` |
| POST | `/payments/:id/reversal` | `payments.refund` | `{reason}`; only with nothing refunded/allocated (`PAYMENT_NOT_REVERSIBLE`) |
| POST | `/payments/:id/receipt?layout=` | `payments.read` | Receipt PDF; new version after reversal |
| GET | `/customers/:id/account` | `payments.read` | received / refunded / allocated / on account |
| GET | `/reports/collections?from=&to=&branchId=` | `reports.read` + `payments.read` | By method and cashier; reversed excluded; refunds by refund date |
| GET | `/customer/payments` | customer | Own receipts |
| POST | `/customer/payments/:id/receipt` | customer | Own receipt PDF |

## Phase 9 endpoints (delivery, ADR 0017)

`DELIVERED`, `OUT_FOR_DELIVERY` and the failed-attempt return are reachable only through these endpoints
(`USE_DELIVERY_WORKFLOW` from the generic transition endpoint).

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/jobs/:id/deliveries` | `deliveries.read` | Deliveries, interim balance (approved estimate − net payments), required hand-over items |
| POST | `/jobs/:id/deliveries/dispatch` | `deliveries.write` | `{version, mode: HOME_DELIVERY|OTHER, address}` → OUT_FOR_DELIVERY, challan number issued |
| POST | `/jobs/:id/deliveries/handover` | `deliveries.complete` | `Idempotency-Key`; recipient, relationship (+ authorization), every intake item returned, proof (signed challan or photo), checklist; balance due ⇒ `deliveries.due_override` + `dueOverrideReason` (else `BALANCE_DUE`); releases open part reservations; → DELIVERED |
| POST | `/deliveries/:id/failed-attempt` | `deliveries.write` | `{reason}` → READY_FOR_DELIVERY |
| POST | `/deliveries/:id/challan?layout=` | `deliveries.read` | Challan PDF; new version when the delivery status changes |
| GET | `/deliveries?from=&to=&branchId=` | `deliveries.read` | Delivery register |

## Phase 10 endpoints (providers, ADR 0018)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/webhooks/whatsapp` | public (verify token) | Meta subscription handshake; returns `hub.challenge` as text, 403 on wrong token, 404 when not configured |
| POST | `/webhooks/whatsapp` | `X-Hub-Signature-256` | HMAC-SHA256 of raw body with app secret, else 401. Status callbacks move deliveries forward only (ACCEPTED → DELIVERED → READ; ACCEPTED → FAILED marks the notification DEAD for manual retry). Replies STOP/UNSUBSCRIBE/OPT OUT withdraw WhatsApp consent (audited) |
| PUT | `/settings/notifications` | `settings.manage` | Approved template name/language per event, email subject, quiet hours |

`POST /customer/auth/otp/request` returns **503 `OTP_DELIVERY_FAILED`** when the WhatsApp provider refuses the code.
Manual retry (`POST /notifications/:id/retry`) keeps the attempt count; after the automatic limit it grants one more attempt.

## Customer web-portal sessions (ADR 0023)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/customer/auth/web/verify` | Body as `/customer/auth/otp/verify`; returns access token only and sets HttpOnly `icon_crt` cookie |
| POST | `/customer/auth/web/refresh` | Cookie + `X-ICON-CSRF: 1` + allowed Origin; rotates the cookie |
| POST | `/customer/auth/web/logout` | Cookie + CSRF header; revokes the session, clears the cookie (204) |

## Phase 7 endpoints (GST invoicing, ADR 0021/0022)

Invoices are issued only when the business profile (with GSTIN), currency and an **approved** tax configuration exist.

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/invoicing/status` | `invoices.read` | `{blockers[], taxStatus}` |
| GET / POST | `/jobs/:id/invoices` | `invoices.read` / `invoices.write` | List; create draft from the approved estimate's customer-pay lines (job must be repair-completed or later); returns the existing draft if one exists |
| GET | `/invoices?from&to&status&branchId&page&pageSize` | `invoices.read` | Register (dates are invoice dates) |
| GET / PUT / DELETE | `/invoices/:id` | `invoices.read` / `invoices.write` | Draft edit `{rowVersion, lines[], notes?, documentType?: TAX_INVOICE\|BILL_OF_SUPPLY, documentTypeReason?}` (reason required for a Bill of Supply) recalculates; delete drafts only |
| POST | `/invoices/:id/issue` | `invoices.issue` + `Idempotency-Key` | Number `MT/{FYS}/{SEQ:1}` (tax invoice) or `BS/{FYS}/{SEQ:1}` (Bill of Supply), final GST with rates in force today (none for a Bill of Supply), zero-value totals allowed, snapshots, HSN summary, automatic allocation of the job's payments, `INVOICE_ISSUED` notification. 409 `TAX_CONFIG_NOT_APPROVED` / `CONFIGURATION_REQUIRED` / `NOTHING_TO_INVOICE` |
| POST | `/invoices/:id/pdf` | `invoices.read` | Tax invoice PDF (generated once) |
| POST | `/invoices/:id/credit-notes` | `credit_notes.issue` + `Idempotency-Key` | `{reason, full?, lines[{invoiceLineId, quantity}]}`; full credit cancels the invoice; frees allocations beyond the new balance |
| POST | `/credit-notes/:id/pdf` | `invoices.read` | Credit note PDF |
| POST | `/invoices/:id/allocations` | `payments.record` | `{paymentId, amount}` from the customer's on-account money |
| POST | `/allocations/:id/release` | `payments.refund` | `{reason}` — money returns to account (e.g. before reversing a bounced cheque) |
| GET | `/reports/gst-summary?from&to&branchId` | `reports.read` + `invoices.read` | Invoices − credit notes; B2B/B2C, by rate, by HSN/SAC. Exports `invoices`, `gst-summary` |
| GET | `/customer/invoices`, POST `/customer/invoices/:id/pdf`, `/customer/credit-notes/:id/pdf` | customer token | Own issued invoices only |

Settings keys added: `business`, `tax`, `invoicing`, `numbering.invoiceNumber`, `numbering.billOfSupplyNumber`, `numbering.creditNoteNumber`. Invoice responses carry `documentType` and `documentTypeReason`; the GST summary adds `billsOfSupply {count, total, credited}`, kept out of all GST figures (ADR 0024).

## Phase 11 endpoints (two-step sign-in, ADR 0011)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/auth/login` | public | With MFA on, returns `{mfaRequired: true, challengeToken, expiresIn}` and **no** cookie/session. Otherwise the token response, now with `mfaEnrollmentRequired` |
| POST | `/auth/mfa/verify` | public (rate-limited) | `{challengeToken, code}` — 6-digit TOTP or recovery code → token response + refresh cookie. Wrong → 401 `MFA_INVALID`; expired/spent challenge → 401 `INVALID_TOKEN` |
| GET | `/auth/mfa` | signed-in staff | `{enabled, required, recoveryCodesRemaining}` |
| POST | `/auth/mfa/enrollment` | signed-in staff | `{secret, otpauthUri}` (shown once; `Cache-Control: no-store`); 409 when already on |
| POST | `/auth/mfa/enrollment/confirm` | signed-in staff | `{code}` → `{recoveryCodes: string[10]}` (shown once) |
| POST | `/users/:id/mfa/reset` | `users.manage` | `{reason}`; not for oneself; signs the user out; audited |

While `mfaEnrollmentRequired` is true, every other route answers 403 `MFA_ENROLLMENT_REQUIRED`. The full,
generated route list with access rules is in `docs/security/authorization-matrix.md`.

## Phase 11 endpoints (reports, ADR 0019)

All scoped to permitted branches; `branchId` outside scope → 404. Periods are `[from, to)` ISO instants, max 366 days.

| Method | Path | Permission | Notes |
|--------|------|-----------|-------|
| GET | `/reports/dashboard?branchId=` | `reports.read` | New today, by status, overdue, approval/parts/completed/ready counts, collected today/month (net of refunds), interim outstanding, technician workload, 30-day warranty mix |
| GET | `/reports/jobs?from&to&branchId&status&technicianId&categoryId&serviceType&page&pageSize` | `reports.read` + `jobs.read` | Job register (paged, max 100) |
| GET | `/reports/technicians?from&to&branchId` | `reports.read` + `jobs.read` | Open jobs, completed, average/median turnaround hours |
| GET | `/reports/parts?from&to&branchId` | `reports.read` + `inventory.read` | Usage (consumed/returned/net) and indicative stock valuation |
| GET | `/reports/outstanding?branchId` | `reports.read` + `payments.read` | Interim receivables with aging buckets |
| GET | `/reports/:report/export?format=csv\|xlsx\|pdf&…filters` | `reports.read` + `reports.export` + report's read permission | `report` ∈ jobs, technicians, parts, outstanding, collections, deliveries. Attachment, `Cache-Control: no-store`, audited. > 10,000 rows → `EXPORT_TOO_LARGE` |

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
