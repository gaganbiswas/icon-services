# 0018 — Notification providers: WhatsApp (Meta Cloud API), email (SMTP), OTP via WhatsApp

- **Status:** Approved (owner, 2026-11-18): Meta Cloud API direct; SMTP for email; sign-in codes via WhatsApp
  authentication template. Item "Queue" below is **proposed** and needs owner confirmation.
- **Date:** 2026-11-18

## WhatsApp — Meta Cloud API (official WhatsApp Business Platform)

- Adapter calls `POST {base}/{version}/{phone-number-id}/messages` with a bearer access token; only **approved
  templates** are used for business-initiated messages. Configuration from environment / secrets manager only
  (`WHATSAPP_*`), never in clients or the database.
- Template name + language per event live in setting `notifications.templates`; parameter order per event is defined
  in code and documented in `docs/notification-templates.md` for registration with Meta. Events without an approved
  template are recorded `SKIPPED_NOT_CONFIGURED` (never sent free-form).
- Errors: HTTP 429 / 5xx / throttling codes are retryable (backoff); other 4xx are permanent → notification `DEAD`
  immediately, visible in the notification centre for manual retry after fixing configuration.
- **Webhooks** (`/api/v1/webhooks/whatsapp`): GET verification (`hub.verify_token`), POST verified with
  `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret; constant-time compare; unsigned/invalid → 401).
  Status callbacks update deliveries: `delivered` → `DELIVERED`, `read` → `READ`, `failed` → `FAILED` with error code;
  never downgrade; unknown message IDs ignored. Message content is never stored or logged.
- **Opt-out:** inbound replies `STOP`, `UNSUBSCRIBE`, `OPT OUT` (case-insensitive) withdraw the customer's WhatsApp
  consents (source `WHATSAPP_REPLY`); later sends are skipped by the consent check. Opt-in remains an explicit,
  recorded consent.

## Email — SMTP

- Standard SMTP (works with Amazon SES, Postmark, SendGrid, Zoho, Google Workspace…). Provider is a configuration
  choice (`SMTP_*`, `EMAIL_FROM`). Owner must verify the sender domain and publish SPF, DKIM and DMARC.
- SMTP gives no delivery callback, so email deliveries remain `ACCEPTED` (never `DELIVERED`) — CLAUDE.md §11.15.
- Local development and CI use **Mailpit** (SMTP capture) — no real email leaves the machine.

## Customer sign-in codes — WhatsApp authentication template

- `OTP_PROVIDER=whatsapp` sends the code with an approved **authentication** template (code as body parameter and
  copy-code button parameter). Template name/language from `WHATSAPP_OTP_TEMPLATE_*`.
- The development mock remains for local use; production refuses the mock.

## Provider selection and safety

- `WHATSAPP_PROVIDER = meta | mock | disabled`, `EMAIL_PROVIDER = smtp | mock | disabled`. Production refuses `mock`.
  `disabled` records `SKIPPED_NOT_CONFIGURED`.
- Quiet hours (setting, off by default): notifications due inside the window are deferred to its end.
- Live sending must first be tested against Meta's test phone number / sandbox and a test mailbox (owner action).

## Queue (PROPOSED — owner to confirm)

ADR 0013 planned to add BullMQ in this phase. Recommendation: **keep the PostgreSQL outbox as the queue** — it is
transactional with the business change, already provides bounded retries, exponential backoff, dead-letter (`DEAD`),
manual retry, multi-worker safety (`FOR UPDATE SKIP LOCKED` + leases) and operator visibility, all covered by tests.
Adding BullMQ would duplicate retry state across two stores. Redis remains for rate limits/caching. If the owner
prefers BullMQ per CLAUDE.md §3, it can be added as a delivery mechanism behind the outbox.
