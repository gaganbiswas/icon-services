# Threat Model — ICON INFOSYS SERVICE MANAGEMENT

Status: **Updated Phase 2 (2026-11-18)** — status column shows what is implemented and tested. Method: STRIDE per trust boundary. To be revisited
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

| # | Threat (STRIDE) | Example | Mitigation | Status |
|---|-----------------|---------|------------|--------|
| T1 | Spoofing | Credential stuffing on staff login | Argon2id, rate limits, lockout, MFA for privileged roles | Phase 2: Argon2id, per-IP rate limit, lockout — tested. Phase 11: TOTP MFA enforced for privileged roles (production), replay protection, recovery codes, failures count toward lockout — tested |
| T2 | Spoofing | Stolen refresh token | Rotation with reuse detection → revoke family; HttpOnly SameSite cookies (web); OS secure storage (mobile) | Phase 2: rotation + reuse detection — tested |
| T3 | Spoofing | Forged provider webhook | Verify webhook signatures; reject unsigned | Phase 10: HMAC-SHA256 constant-time, unsigned/tampered → 401 — tested |
| T4 | Tampering | Customer changes job/customer ID in URL (IDOR) | Customer identity from token only; ownership checks in queries; IDOR tests | Phase 2–3: org/branch scoping, 404 on foreign IDs; customer identity from token — tested. Phase 11: every route checked for missing/wrong token and missing permission (authorization matrix) — tested |
| T5 | Tampering | Staff edits issued invoice / price | Issued invoices immutable (DB triggers); corrections via append-only credit notes; permissioned (MFA-privileged) and audited | Done (Phase 7) |
| T6 | Tampering | Status jump bypassing approval | Transition matrix in domain service; approval-before-repair check | Phase 4–5 |
| T7 | Tampering | Malicious upload (HTML/SVG/executable) | MIME sniffing, allow-list, size limits, random keys, `Content-Disposition: attachment`, malware scan where available | Phase 3 |
| T8 | Repudiation | "I didn't approve that estimate" | Store decision, version, timestamp, method, IP/device where lawful; audit log | Phase 5 |
| T9 | Info disclosure | Internal technician notes leaked to customer | Separate visibility field; customer DTOs whitelist fields; tests | Phase 4 |
| T10 | Info disclosure | Cross-branch data access | Branch scope enforced in repository layer; tests | Phase 2: branch scope — tested. Phase 11: reports/exports scoped in SQL — tested |
| T11 | Info disclosure | PII / tokens in logs | Structured logging with redaction; never log OTPs/passwords/tokens | Phase 1–2: no secrets in logs/audit — tested |
| T12 | Info disclosure | Permanent public file URLs | Short-lived signed URLs after authorization | Phase 3 |
| T13 | Info disclosure | Secrets in mobile/web bundle | Provider credentials server-side only; secrets manager in production | Phase 1–2: secrets server-side only |
| T14 | Denial of service | OTP/SMS pumping, approval-link brute force | Rate limits, single-use expiring high-entropy tokens, CAPTCHA if needed | Phase 2: login/set-up rate limits (in-memory, single instance) |
| T15 | Denial of service | Notification provider outage blocks billing | Outbox + async queue; transactions never wait on providers | Phase 4/10 |
| T16 | Elevation | Reception grants itself Accounts permissions | Permission-management permission restricted to Super Admin; audited | Phase 2: escalation guards — tested |
| T17 | Elevation | Reopening delivered job to alter values | Elevated permission + reason; audit | Phase 4 |
| T18 | Integrity | Duplicate job/invoice numbers under concurrency | Locked sequences in transaction; unique constraints; idempotency keys | Phase 3/7 |
| T19 | Integrity | Floating-point money errors | NUMERIC + decimal library only (ADR 0005); unit tests | ADR 0005 approved; Phase 7 |
| T21 | Tampering | Spreadsheet formula injection via exported customer data | Prefix `= + - @` tab/CR with `'`; XLSX text cells typed as strings | Phase 11 — tested |
| T22 | Info disclosure / integrity | Backup theft or tampering | CMS AES-256-GCM to an offline recipient key; checksum; decrypt-and-authenticate before restore; drill refuses non-scratch targets | Phase 11 — drill verified locally |
| T20 | Supply chain | Malicious dependency | Lockfile, `bun audit`/dependency audit in CI, minimal deps, secret scan | Phase 1: lockfile, `bun audit`, gitleaks in CI |

## 4. Residual risks / to decide

- Legal basis, retention and deletion procedures depend on jurisdiction (owner questions G53–G54).
- Data residency depends on hosting choice (G50).
- Backup encryption and restore drill implemented (Phase 11, `docs/deployment-runbook.md`); production schedule, storage location and RPO/RTO depend on hosting (G49–G52).
- Rate limits are in-memory per API instance; move to Redis before running more than one instance.
