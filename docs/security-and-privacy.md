# Security and privacy

> Summary of implemented controls and how they are verified. Listing a control does not make the system
> "secure" or "compliant" (CLAUDE.md §8): legal review of privacy/tax matters and an independent security review are
> still required before go-live.

## Authentication

- Staff: Argon2id passwords, per-IP rate limits, account lockout, 15-minute access tokens, rotating refresh tokens
  with reuse detection (HttpOnly, SameSite cookie + CSRF header), password set-up links instead of default passwords.
- Two-step sign-in (TOTP) mandatory for privileged roles in production (ADR 0011): sealed secrets, replay protection,
  single-use recovery codes, failures count toward lockout, audited admin reset.
- Customers: one-time codes via WhatsApp authentication template (ADR 0018), separate token audience.

## Authorization

- Every route is authenticated unless explicitly public; permissions checked on every request; records scoped to
  organization and permitted branches (out-of-scope → 404); customer identity only from the customer token.
- `docs/security/authorization-matrix.md` is generated from the code. The test
  `apps/api/test/authorization-matrix.int.test.ts` calls **every** protected route without a token, with the wrong
  token type and as a staff user without roles, and fails if any route answers anything other than 401/403, or if a
  new staff route has no permission without being reviewed.

## Data protection

- Money as NUMERIC(19,4) with decimal arithmetic; financial, stock, delivery, status and audit records are
  append-only or frozen by database triggers.
- Internal notes never reach customer DTOs; customer-facing statuses are a separate mapped set.
- Files: MIME sniffing, allow-list, size limits, random storage keys, short-lived signed URLs.
- Report exports need `reports.export`, are audited (no row data in the audit log) and neutralize spreadsheet
  formulas.
- Logs and audit entries are redacted; no passwords, tokens, OTPs, MFA secrets or message content.
- Backups are encrypted to an offline key and authenticated before restore (`docs/deployment-runbook.md`).

## Accessibility

- Every admin and customer-portal UI test ends with an axe-core scan (WCAG 2.1 A/AA + best practice); any violation
  fails the test. Colour contrast cannot be measured in jsdom and must be checked in browser testing (UAT).

## Verification commands

| Check | Command |
|-------|---------|
| Lint, types, unit tests, build | `bun run check` |
| Integration (real PostgreSQL, S3, SMTP) incl. authorization matrix, MFA, IDOR | `bun run test:integration` |
| Dependency audit | `bun run audit` (accepted exception recorded in `docs/security/dependency-audit.md`) |
| Secret scan | gitleaks in CI |
| Volume/performance | `bun run test:perf` |
| Backup + restore drill (local) | `bun run backup:drill:local` |

## Privacy — open items (owner / legal)

- Applicable law, legal basis, retention periods and deletion/anonymization rules (owner questions 53–54).
- Customer data export and deletion requests: procedure and tooling to be defined once retention is confirmed.
- Privacy policy, consent wording (including "reply STOP" for WhatsApp) and terms.
- Data residency depends on hosting (question 50).
