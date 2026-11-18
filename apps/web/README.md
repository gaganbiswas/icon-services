# @icon/web

Customer web portal: Next.js 16 App Router (ADR 0008). Desktop and mobile
browsers. Staff workspaces live in `apps/admin`, not here.

- `bun run dev` — http://localhost:3000
- `bun run build` / `bun run start`
- `bun run test` — Vitest + Testing Library

Rules: no secrets in client bundles (only `NEXT_PUBLIC_*` values are exposed);
customer identity always comes from the authenticated session, never from IDs
in URLs (CLAUDE.md §7).
