# 0012 — Phase 3: customers, assets, intake, numbering, documents, customer sign-in

- **Status:** Approved for implementation (owner: "start with phase 3", 2026-11-18).
  Items marked **PLACEHOLDER** are configurable defaults pending owner answers.
- **Date:** 2026-11-18

## Numbering (job numbers, customer codes)

- Table `number_sequences (organization_id, branch_id, document_type, period_key, current_value)`.
  Next value via a single atomic `INSERT … ON CONFLICT DO UPDATE SET current_value = current_value + 1 RETURNING`
  inside the business transaction — concurrency-safe, never `MAX()+1`. Gaps are possible when a
  transaction rolls back (acceptable for job numbers; invoice numbering rules are decided in Phase 7).
- Job number format is an organization setting (`numbering.jobNumber`), **PLACEHOLDER default**
  `{BRANCH}-{YYYY}-{SEQ:6}`, reset yearly (owner question D29). Customer code default `C{SEQ:6}`, never reset.
- Year boundaries use the branch time zone, else organization time zone, else **UTC (PLACEHOLDER**, B12).

## Customers and assets

- Customers have separate `customer_addresses` rows (`BILLING`, `SERVICE`); phone numbers stored as E.164
  (`libphonenumber-js`) plus display value; default region for parsing is an organization setting
  (**PLACEHOLDER** none — numbers must include a country code until B11/B12 answered).
- Tax identifier column is optional and unvalidated beyond length until the jurisdiction is confirmed.
- Consents are append-only rows (channel × purpose); withdrawal timestamps the active row.
  Policy version string is a setting (**PLACEHOLDER** `UNCONFIRMED-DRAFT`, G54).
- Asset categories are rows (seeded DESKTOP, LAPTOP, PRINTER, MONITOR, OTHER); category-specific attributes
  are validated JSONB defined in `packages/contracts`. Serial numbers are **not** unique: duplicates
  produce a warning.

## Jobs (intake)

- Service types `IN_WARRANTY | OUT_OF_WARRANTY | WARRANTY_UNVERIFIED`; modes `AT_SERVICE_CENTRE | ON_SITE`.
- Initial internal status `RECEIVED` for staff intake. **Addition:** status `AWAITING_DEVICE` for complaints
  submitted by customers before the device reaches the centre (customer-facing: "Request received").
  Reception moves it to `RECEIVED` at physical intake (Phase 4 lifecycle).
- Append-only `job_status_history` row written in the intake transaction.
- `POST /jobs` requires an `Idempotency-Key` header; keys are scoped to the actor and operation, the request
  body hash is stored, and a retry returns the original response. Reuse with a different body → 422.

## Files

- S3-compatible storage (SeaweedFS locally) via AWS SDK v3; random storage keys; uploads limited to
  10 MB, type sniffed from content (`file-type`) against an allow-list (JPEG, PNG, WebP, HEIC, PDF);
  SVG/HTML never accepted. Downloads only through authorized API calls returning short-lived (5 min)
  signed URLs. Malware scanning: **not available** in release one — documented risk.

## Documents (job receipt)

- PDFs rendered server-side from HTML with headless Chromium (`playwright-core`) for correct Unicode and
  Indic-script shaping, A4 and 80 mm thermal layouts (print CSS). Each generated document is stored with an
  immutable data snapshot; reprints reuse the stored file.
- Business details and terms come from settings; **PLACEHOLDER** terms text is printed visibly as
  "Terms and conditions to be confirmed by the business." (H58).
- Production image must include Chromium and Noto fonts (Phase 12 runbook).

## Customer sign-in (Android app / portal)

- Phone number + one-time code (OTP) through an `OtpProvider` adapter. Only a **development mock** provider
  exists (logs the code locally); the API refuses to start with the mock provider in production. A real
  provider is chosen in owner questions E42/F45.
- OTP codes: 6 digits, hashed (SHA-256 with server pepper), 5-minute expiry, 5 attempts, resend throttled,
  generic responses (no account enumeration).
- Sessions reuse `auth_sessions` with `subject_type = CUSTOMER`; the mobile app receives the refresh token in
  the response body and stores it with `expo-secure-store` (no cookies). Customer access tokens use a
  separate audience; staff routes reject them and vice versa.
- A verified phone matching exactly one active customer signs in as that customer; no match creates a new
  customer (name required); several matches → the customer is asked to contact the service centre.
- Customer endpoints derive identity only from the token; customers see only their own records and
  customer-facing status text.
