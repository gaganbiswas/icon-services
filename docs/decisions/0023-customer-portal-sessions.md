# ADR 0023 — Customer web portal: signed-in area and cookie sessions

- Status: Approved (owner instruction "finish everything", 2026-11-19)
- Date: 2026-11-19

## Context

The customer web portal (`apps/web`) only offered single-use estimate links. CLAUDE.md §1 asks for a responsive
customer portal, and §8 requires HttpOnly, SameSite cookies with CSRF protection for browser refresh sessions. The
Android app keeps its refresh token in OS secure storage, which a browser cannot do safely.

## Decision

- Customers sign in with the same WhatsApp code flow as the app (ADR 0018) via `POST /customer/auth/web/verify`.
- The refresh token is set only as cookie `icon_crt` — `HttpOnly`, `SameSite=Strict`, `Secure` in production,
  path `/api/v1/customer/auth/web` — and is never returned in a response body. The access token (15 min) stays
  in page memory only (no localStorage/sessionStorage).
- `web/refresh` and `web/logout` require the `X-ICON-CSRF: 1` header and an allow-listed `Origin` (same check as
  staff sessions, ADR 0010). Rotation and reuse detection are shared with the app (reuse revokes the family).
- Signed-in area `/account`: own jobs, customer-safe timeline, current estimate approve/decline (terms + confirm),
  job receipt, tax invoices, credit notes and payment receipts through short-lived signed links.
- Complaint submission stays in the Android app and at reception for now.
- The portal build embeds `NEXT_PUBLIC_ORGANIZATION_CODE` (required by `build-images.sh`).

## Consequences

- Staff panel, portal and API must be subdomains of one registrable domain (SameSite=Strict cookie).
- Tests: `apps/api/test/customer-web-session.int.test.ts` (cookie flags, CSRF, rotation, reuse, logout) and
  `apps/web/app/account/CustomerPortal.test.tsx`.
