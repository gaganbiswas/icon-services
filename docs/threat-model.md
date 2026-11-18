# Threat Model — ICON INFOSYS SERVICE MANAGEMENT

Status: **Draft (Phase 0).** Method: STRIDE per trust boundary. To be revisited
at Phase 2 (auth), Phase 7 (invoicing), Phase 10 (providers), Phase 11 (hardening).

## 1. Assets

Customer PII (names, phones, addresses, emails), device data and photos (may show
personal data on screens), financial records (invoices, payments), tax
configuration, staff credentials and sessions, provider credentials (WhatsApp,
email, OTP), audit trail, issued documents.

## 2. Trust boundaries

1. Internet ↔ web app / mobile app (untrusted clients).
2. Clients ↔ API (all authorization enforced here).
3. API ↔ PostgreSQL / Redis / object storage (private network only).
4. Worker ↔ third-party providers; provider webhooks → API.
5. Public estimate-approval links and any public tracking page.

## 3. Threats and mitigations

| # | Threat (STRIDE) | Example | Mitigation |
|---|-----------------|---------|------------|
| T1 | Spoofing | Credential stuffing on staff login | Argon2id, rate limits, lockout, MFA for privileged roles |
| T2 | Spoofing | Stolen refresh token | Rotation with reuse detection → revoke family; HttpOnly SameSite cookies (web); OS secure storage (mobile) |
| T3 | Spoofing | Forged provider webhook | Verify webhook signatures; reject unsigned |
| T4 | Tampering | Customer changes job/customer ID in URL (IDOR) | Customer identity from token only; ownership checks in queries; IDOR tests |
| T5 | Tampering | Staff edits issued invoice / price | Issued invoices immutable; corrections via credit notes; permissioned and audited |
| T6 | Tampering | Status jump bypassing approval | Transition matrix in domain service; approval-before-repair check |
| T7 | Tampering | Malicious upload (HTML/SVG/executable) | MIME sniffing, allow-list, size limits, random keys, `Content-Disposition: attachment`, malware scan where available |
| T8 | Repudiation | "I didn't approve that estimate" | Store decision, version, timestamp, method, IP/device where lawful; audit log |
| T9 | Info disclosure | Internal technician notes leaked to customer | Separate visibility field; customer DTOs whitelist fields; tests |
| T10 | Info disclosure | Cross-branch data access | Branch scope enforced in repository layer; tests |
| T11 | Info disclosure | PII / tokens in logs | Structured logging with redaction; never log OTPs/passwords/tokens |
| T12 | Info disclosure | Permanent public file URLs | Short-lived signed URLs after authorization |
| T13 | Info disclosure | Secrets in mobile/web bundle | Provider credentials server-side only; secrets manager in production |
| T14 | Denial of service | OTP/SMS pumping, approval-link brute force | Rate limits, single-use expiring high-entropy tokens, CAPTCHA if needed |
| T15 | Denial of service | Notification provider outage blocks billing | Outbox + async queue; transactions never wait on providers |
| T16 | Elevation | Reception grants itself Accounts permissions | Permission-management permission restricted to Super Admin; audited |
| T17 | Elevation | Reopening delivered job to alter values | Elevated permission + reason; audit |
| T18 | Integrity | Duplicate job/invoice numbers under concurrency | Locked sequences in transaction; unique constraints; idempotency keys |
| T19 | Integrity | Floating-point money errors | NUMERIC + decimal library only (ADR 0005); unit tests |
| T20 | Supply chain | Malicious dependency | Lockfile, `bun audit`/dependency audit in CI, minimal deps, secret scan |

## 4. Residual risks / to decide

- Legal basis, retention and deletion procedures depend on jurisdiction (owner questions G53–G54).
- Data residency depends on hosting choice (G50).
- Backup encryption and restore drills defined in Phase 12.
