# 0008 — Staff admin panel as React + TanStack Router SPA; Next.js 16 for customer portal

- **Status:** Approved
- **Date:** 2026-11-18
- **Approved by:** Project owner ("for admin panel use plain react with tanstack router"; confirmed "Two web apps")

## Context

`CLAUDE.md` §3 originally specified one Next.js app for admin, staff and the
customer portal. The owner decided the staff/admin panel should be plain React
with TanStack Router, while Next.js 16 remains for the web.

## Decision

| Folder        | Technology                                   | Users |
|---------------|----------------------------------------------|-------|
| `apps/admin`  | Vite + React + TanStack Router (file-based routing, client-side SPA) | All staff roles: Super Admin, Branch Admin/Manager, Reception, Technician, Accounts, Delivery Staff, Auditor |
| `apps/web`    | Next.js 16 (App Router)                      | Customers: portal, job tracking, estimate approval links, document access |
| `apps/mobile` | Expo / React Native                          | Customers: Android app |

- `apps/admin`, `apps/web`, `apps/mobile` never import from each other. Shared
  types/validation via `packages/contracts`; shared web components (admin + web)
  via `packages/ui` when needed.
- All three apps use the same React version (pinned to the version Expo SDK
  requires) to avoid duplicate React copies in the workspace.
- The admin SPA holds no secrets; all authorization is enforced by the API.

## Consequences

- Two web deployments (static hosting/CDN for `apps/admin`; Node.js server for
  `apps/web`). Domains to be decided with hosting (owner questions G49–G51).
- Browser session design (Phase 2) must handle the admin SPA on its own origin:
  refresh token in a Secure, HttpOnly, SameSite cookie scoped to the API domain
  (admin and API must be same-site, e.g. `admin.example.com` and
  `api.example.com`), access token held in memory only, CSRF protection on the
  refresh endpoint, strict CORS allow-list.
- Admin SPA is not indexed by search engines (`noindex`).
