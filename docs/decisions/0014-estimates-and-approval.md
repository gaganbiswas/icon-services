# 0014 — Estimates and customer approval

- **Status:** Approved for implementation (owner: "start", 2026-11-18). Defaults below were proposed to the owner
  (questions D33, D34) and are configurable; nothing here is a tax or legal decision.
- **Date:** 2026-11-18

## Estimates

- Versioned per job (`version` 1, 2, …). A version is editable only as `DRAFT`; once `SENT` it is immutable —
  enforced by a database trigger on `estimates` and `estimate_lines`. Revisions create a new version; sending a
  new version marks the previous sent one `SUPERSEDED` and revokes its approval links.
- Lines: `LABOUR | PART | SERVICE_FEE | OTHER`, quantity, unit, unit price, line discount (absolute), and
  **coverage** `CUSTOMER_PAY | WARRANTY | GOODWILL` (CLAUDE.md §4.4). Warranty and goodwill lines show their value
  but are not payable by the customer.
- Money: `NUMERIC(19,4)` and `decimal.js` (ADR 0005). Totals are always recomputed on the server from lines; client
  totals are never trusted. No rounding is applied (rounding rules await the accountant).
- **Tax:** not calculated. Each line records `tax_treatment = NOT_CONFIGURED` and documents say
  "Taxes, if applicable, to be confirmed". Phase 7 introduces approved tax configuration.
- **Currency:** never assumed. Estimates require setting `money.currency` (ISO 4217) by `settings.manage`;
  until then creation fails with `CONFIGURATION_REQUIRED`.
- Validity: setting `estimates.validityDays` (**default 14**); estimate terms text is a setting
  (**PLACEHOLDER** until supplied, H59).

## Customer decision

- Customers approve or reject (a) in the Android app / authenticated portal, or (b) through a **secure, expiring,
  single-use link**: 256-bit token stored as SHA-256, expires at the estimate's validity end (max 14 days),
  revoked when superseded, consumed by the decision. The token travels in the URL fragment of the customer website
  (`apps/web /estimate#token=…`), never in query strings or server logs. Public link endpoints are rate-limited.
- Approval requires explicit acceptance of the terms shown (`termsAccepted = true`); the decision stores estimate
  version, method, timestamp, terms hash, and client IP / user agent only when `AUDIT_STORE_CLIENT_METADATA=true`.
  Decisions are append-only and one per estimate.
- Staff cannot record approvals on a customer's behalf in this release (not in CLAUDE.md; open question).
- Links are shown once to the staff member who sends the estimate to share manually; automatic WhatsApp/email
  delivery arrives with real providers (Phase 10). An `ESTIMATE_READY` notification is queued (mock providers).

## Workflow integration (ADR 0013)

- Sending an estimate moves the job `ESTIMATE_PREPARATION → AWAITING_CUSTOMER_APPROVAL`.
- `AWAITING_CUSTOMER_APPROVAL → REPAIR_IN_PROGRESS | WAITING_FOR_PARTS` requires the job's current estimate to be
  `APPROVED` and unexpired at decision time.
- New transition `AWAITING_CUSTOMER_APPROVAL → READY_FOR_DELIVERY` ("return unrepaired"): requires the current
  estimate to be `REJECTED`, plus a reason (**default** for D34).
- **Diagnostic fee:** none by default (D33). No repair can start without approval.
- Estimate/quotation PDF is produced together with invoice documents in Phase 7 (shared money/tax wording).
