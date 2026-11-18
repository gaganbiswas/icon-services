# @icon/config

Shared configuration. No runtime code.

- `tsconfig/base.json` — strict compiler options used everywhere.
- `tsconfig/node-library.json` — Node.js ESM packages (`packages/contracts`, `packages/database`).
- `tsconfig/nestjs.json` — `apps/api` (adds decorator metadata).
- `tsconfig/react-vite.json` — `apps/admin`.
- `eslint/base` — type-aware TypeScript rules (`no-explicit-any` is an error).
- `eslint/react` — base + React hooks rules for browser apps.

`apps/web` (Next.js) and `apps/mobile` (Expo) extend their framework's own
tsconfig/ESLint presets and add the strict options from `base.json`.
