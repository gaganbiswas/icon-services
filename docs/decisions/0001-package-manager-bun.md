# 0001 — Package manager and script runner: Bun

- **Status:** Approved
- **Date:** 2026-11-18
- **Approved by:** Project owner (instruction: "use bun instead of npm")

## Context

`CLAUDE.md` §3 recommends pnpm workspaces + Turborepo. The project owner has
instructed that Bun be used instead of npm. This record overrides the pnpm
recommendation in `CLAUDE.md` §3 and the `pnpm-workspace.yaml` entry in the
suggested repository layout.

## Decision

- Use **Bun 1.4.4** (upgraded from 1.2.3 with owner approval, 2026-11-18) as the package manager, using Bun
  workspaces declared in the root `package.json` (`"workspaces": ["apps/*", "packages/*"]`).
- Commit `bun.lock` (text lockfile). Do not commit `package-lock.json`,
  `yarn.lock` or `pnpm-lock.yaml`.
- Keep **Turborepo** for task orchestration and caching (it supports Bun
  workspaces). Root scripts invoke `bunx turbo run <task>`.
- Pin the Bun version in the root `package.json` `packageManager` field and in CI.
- Use `bun install --frozen-lockfile` in CI.
- `bunfig.toml` sets `linker = "hoisted"` so Expo/Metro and Next.js resolve a
  single hoisted copy of React/React Native.
- Dependency audit: `bun audit` (available since Bun 1.2.15).

## Consequences

- No `pnpm-workspace.yaml`; workspace definition lives in root `package.json`.
- Bun is used as package manager/script runner. Which **runtime** executes
  the API in production is a separate decision (see 0006).
- Expo/React Native: Expo supports Bun as package manager; Metro bundler and
  EAS build still run on Node.js. Node.js must remain installed.
- `CLAUDE.md` §3, the repository layout and Phase 1 were updated to Bun
  (owner approved 2026-11-18).

## Alternatives considered

- pnpm (original recommendation) — rejected by owner.
- npm — rejected by owner.
