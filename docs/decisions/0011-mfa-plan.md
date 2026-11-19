# 0011 — MFA plan: TOTP for privileged roles

- **Status:** Implemented (Phase 11, 2026-11-19). Enforcement: `MFA_ENFORCEMENT=required` (mandatory in
  production, validated at start-up); development/test default `optional`.
- **Date:** 2026-11-18

## Plan

- Method: TOTP (RFC 6238, 30 s, 6 digits, SHA-1 for authenticator compatibility),
  enrolled by QR code in the admin panel.
- Required for users holding any of: `roles.manage`, `users.manage`,
  `settings.manage`, `invoices.issue`, `invoices.void`, `payments.refund`,
  `branches.all`. Optional for others.
- TOTP secrets encrypted at rest (AES-256-GCM, key from secrets manager), never
  logged or returned after enrolment.
- 10 single-use recovery codes, stored hashed (Argon2id).
- Login becomes two-step: password → short-lived MFA challenge token → TOTP/recovery
  code → session issued. Replay of the same TOTP step is rejected.
- MFA reset by another Super Admin only, with audit reason.
- Until implemented, privileged accounts exist only in development/UAT.

## Implementation notes (Phase 11)

- Tables `user_mfa` (sealed secret, enabled time, last accepted time step), `user_mfa_recovery_codes`
  (Argon2id hashes, single use), `mfa_challenges` (hashed token, 5-minute expiry, max 5 attempts, single use).
- Codes from the previous/current/next 30 s step are accepted; a step is accepted at most once (conditional
  update — replay-safe under concurrency). Wrong codes count toward the account lockout.
- The sealed secret binds the user ID as authenticated data (cannot be moved to another user).
- Privileged users without MFA get a session in which only `/me`, own password change and MFA set-up work
  (`MFA_ENROLLMENT_REQUIRED` elsewhere); the admin panel sends them to the set-up screen.
- Reset: `POST /users/:id/mfa/reset` with `users.manage`, never for oneself, only for users holding no permission the
  actor lacks; requires a reason, signs the user out everywhere, audited (`mfa.reset`).
- Losing `MFA_ENCRYPTION_KEY` makes all secrets unreadable: users would need a reset. Back the key up in the
  secrets manager.
- **Difference from the plan (owner to confirm):** the plan said "reset by another Super Admin only". The
  implementation applies the existing user-management rule instead: a Super Admin's MFA can only be reset by another
  Super Admin (nobody else holds all of their permissions), but e.g. a Branch Admin with `users.manage` can reset a
  receptionist's MFA. Restricting resets to Super Admins only is a one-line change if preferred.
