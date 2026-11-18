# 0010 — Staff authentication, sessions and RBAC

- **Status:** Approved (owner approved Phase 2, 2026-11-18)
- **Date:** 2026-11-18

## Scope

Staff users of `apps/admin`. Customer sign-in (web portal, Android app) is
**not** covered: it depends on the OTP provider decision (owner questions E42, F45).

## Passwords

- Argon2id (`@node-rs/argon2`, prebuilt native binaries), parameters
  memory 19 MiB, iterations 2, parallelism 1 (OWASP minimum), tunable via code constant.
- Policy: 12–128 characters, no composition rules, must differ from email (NIST SP 800-63B style).
  Maximum length bounds hashing cost.
- Login errors are generic ("invalid credentials"); unknown emails still run a
  hash verification to equalise timing (no account enumeration).
- Lockout: 5 consecutive failures lock the account for 15 minutes (configurable).
  Login is also rate-limited per client IP.

## Tokens and sessions

- **Access token:** JWT (HS256 via `jose`), 15-minute lifetime, claims `sub`, `sid`,
  `org`, `iss`, `aud`, `iat`, `exp`. Held **in memory** by the admin SPA, sent as
  `Authorization: Bearer`. Every request re-checks the session and user in the
  database, so revocation and deactivation take effect immediately.
- **Refresh token:** 256-bit random opaque value; only its SHA-256 hash is stored.
  Sent in cookie `icon_rt`: `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth`,
  `Secure` outside local development.
- **Rotation:** each refresh issues a new refresh token and marks the old one used.
  Presenting an already-used token = reuse → the whole session (token family) is
  revoked and audited. Consequence: the SPA must serialise refresh calls.
- **Lifetimes:** refresh token idle lifetime 7 days; session absolute lifetime 30 days.
- **CSRF:** cookie endpoints (`/auth/refresh`, `/auth/logout`) require the custom
  header `X-ICON-CSRF: 1` (forces a CORS preflight that the origin allow-list
  blocks) and reject requests whose `Origin` is not allow-listed, in addition to
  `SameSite=Strict`.

## Password set-up and reset (no email provider yet)

- Admins never choose or see staff passwords. Creating a user, or an admin reset,
  issues a **one-time password-set-up token** (hashed at rest, 60-minute expiry,
  single use) shown once to the issuing admin to hand over securely.
- Completing a set-up/reset revokes all of the user's sessions.
- Self-service "forgot password" by email is added once an email provider is
  chosen (Phase 10).

## RBAC and scoping

- Permissions are a fixed catalogue of codes (`packages/contracts`); roles are
  per-organization sets of permissions. Seeded system roles follow `CLAUDE.md` §2;
  administrators with `roles.manage` can create roles and change permissions.
  The Super Admin role's permissions cannot be reduced (lock-out protection).
- Every protected route declares required permissions; the API checks them on
  every request. UI hiding is not authorization.
- Organization scope: every query filters by the principal's organization.
  Records in another organization respond **404** (no existence leak).
- Branch scope: users have explicit branch access; `branches.all` grants all
  branches of the organization.
- **Escalation prevention:** an actor may only assign roles whose permissions are
  a subset of the actor's own, only grant branches the actor can access, and may
  not modify a user who holds permissions the actor lacks. Users cannot deactivate
  themselves or change their own roles.

## Audit

- `audit_logs` is append-only: a database trigger rejects `UPDATE` and `DELETE`.
  Production database role must not hold `TRUNCATE` (deployment runbook, Phase 12).
- Audit rows are written in the same transaction as the change they describe.
  `before`/`after` snapshots are redacted (password hashes, tokens never stored).
- Client IP and user agent are stored on audit rows and sessions only when
  `AUDIT_STORE_CLIENT_METADATA=true` ("where lawful" — owner question G56).
