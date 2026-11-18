# Dependency audit policy and exceptions

CI runs `bun run audit` (`bun audit --audit-level=high` with the exceptions
below). Any new **high** or **critical** advisory fails the build.

Exceptions must name the advisory, the affected path, why it is not
exploitable here, who accepted it, and a review date. Remove an exception as
soon as a fixed version is available.

| Advisory | Package | Severity | Reached via | Why accepted | Accepted by | Review by |
|----------|---------|----------|-------------|--------------|-------------|-----------|
| [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) | picomatch ≤4.0.7 (ReDoS on crafted extglob patterns) | High | Build/test tooling only: Vite, Vitest, Metro, Jest, ESLint, TanStack router plugin, Nest CLI | No fixed version published (verified 2026-11-18). Glob patterns come from our own config files, not from users or network input; not used by the API at runtime. | **Pending owner acknowledgement** | 2026-12-18 |

## Known moderate advisories (below CI threshold, tracked)

| Advisory | Package | Reached via | Note |
|----------|---------|-------------|------|
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch 7–11.0.0 | Jest / Babel istanbul tooling (mobile tests) | Fix requires major upgrades inside third-party trees; dev-only. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob 9–14.0.1 | Jest tooling | Dev-only. |
