# 0011 — MFA plan: TOTP for privileged roles

- **Status:** Approved as plan (owner accepted authenticator-app MFA, 2026-11-18).
  Implementation scheduled before production (target: Phase 11 hardening at the latest).
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
