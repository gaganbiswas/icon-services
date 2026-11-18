# 0003 — Separate folders for web and mobile applications

- **Status:** Approved
- **Date:** 2026-11-18
- **Approved by:** Project owner ("Web/Desktop and mobile app should be in different folders")

## Decision

Monorepo layout keeps each client application in its own folder with its own
`package.json`, build, and tests:

```text
apps/
  api/      # NestJS REST API + background worker bootstrap
  admin/    # Vite + React + TanStack Router — staff admin panel (ADR 0008)
  web/      # Next.js 16 — customer web portal, desktop and mobile browsers
  mobile/   # Expo / React Native — Android customer app
packages/
  database/   # Prisma schema, migrations, seed
  contracts/  # shared Zod schemas, enums, API types (no UI, no secrets)
  ui/         # shared web UI components
  config/     # shared TypeScript/lint/format configuration
```

- `apps/admin`, `apps/web` and `apps/mobile` never import from each other.
- Shared code goes only through `packages/contracts` (types/validation).
- Business logic lives only in `apps/api`.

## Resolved (2026-11-18)

"Web/Desktop" means the **responsive website only**, used in desktop and mobile
browsers. **No installable desktop application** will be built (owner answer A1).
