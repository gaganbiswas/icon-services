# Deployment and operations runbook

> Status: Phase 12. Hosting decided (ADR 0020: Linux VPS + Docker, India, RPO 24 h / RTO 1 day). Step-by-step
> production deployment: [`docs/production/README.md`](production/README.md). Never put real secrets in this file.

## 1. Components

| Process | Command | Notes |
|---------|---------|-------|
| API | `node apps/api/dist/main.js` | Stateless; health: `GET /api/v1/health/live`, `/api/v1/health/ready` (DB, Redis, S3) |
| Worker | `node apps/api/dist/worker.js` | Notification outbox; safe to run several (row claiming + leases) |
| Admin panel | static files from `apps/admin/dist` | Served by any static host/CDN; `VITE_API_BASE_URL` at build time |
| Customer portal | `next start` in `apps/web` | |
| PostgreSQL 17 | managed service recommended | Point-in-time recovery if the host supports it |
| Redis 7 | | Rate limits / caching |
| S3-compatible storage | | Private bucket; signed URLs only |

## 2. Configuration and secrets

- All configuration is validated at start-up (`apps/api/src/config/env.ts`); the process refuses to start on
  invalid or unsafe production settings (mock providers, insecure cookies, MFA not enforced, missing keys).
- Secrets come from the host's secrets manager, never from files in the repository:
  `DATABASE_URL`, `JWT_ACCESS_SECRET`, `OTP_PEPPER`, `MFA_ENCRYPTION_KEY`, `S3_*`, `WHATSAPP_*`, `SMTP_*`.
- `MFA_ENCRYPTION_KEY` and `OTP_PEPPER` must be backed up in the secrets manager: losing the MFA key forces an MFA
  reset for every user.
- Generate keys with `openssl rand -base64 32` (MFA) / `openssl rand -base64 48` (JWT, pepper).

## 3. Releases and migrations

1. Take a backup (§4) and confirm it with a drill on the latest backup at least monthly.
2. `bun run db:deploy` (Prisma `migrate deploy`) — applies committed migrations only. Never edit production
   tables by hand (CLAUDE.md §11.6).
3. Deploy API and worker; check `/health/ready`; smoke-test sign-in and one job lookup.
4. Rollback: redeploy the previous build. Migrations are forward-only; if a migration must be undone, restore from
   the pre-release backup into a new database and switch over (data entered since then must be re-entered).

## 4. Backups

`infra/scripts/backup.sh` streams `pg_dump` (custom format) straight into OpenSSL CMS encryption
(AES-256-GCM) for a **recipient certificate**; the plaintext dump never touches disk. Only the matching private
key — kept **offline** (not on the backup host) — can decrypt, so a stolen backup or backup host does not expose
data. A `.sha256` file is written next to each backup; files older than `RETENTION_DAYS` (default 35) are pruned.

```bash
DATABASE_URL=… BACKUP_DIR=/var/backups/icon BACKUP_CERT=/etc/icon/backup-recipient.pem \
  RETENTION_DAYS=35 infra/scripts/backup.sh
```

- Create the recipient key pair once, on an offline machine:
  `openssl req -x509 -newkey rsa:4096 -nodes -keyout backup-key.pem -out backup-recipient.pem -days 3650 -subj "/CN=icon-backup"`.
  Store `backup-key.pem` in two separate safe places (e.g. password manager + sealed envelope).
- Schedule daily (or more often if RPO requires); copy encrypted files to separate storage in another location.
- Object storage (uploaded photos, issued documents) needs its own versioned, replicated bucket backup — _TBD with host_.
- Managed PostgreSQL point-in-time recovery, if available, is the primary mechanism; these files are the
  host-independent second copy.

## 5. Restore drill (monthly, and before go-live)

`infra/scripts/restore-drill.sh` verifies the checksum, **decrypts and authenticates the whole backup before
restoring** (a tampered or wrong-key file is rejected and nothing is restored), restores into an empty scratch
database whose name contains `drill`, then checks applied migrations, integrity triggers, that `audit_logs` is still
append-only, and (optionally) per-table row counts against a quiet source.

```bash
BACKUP_FILE=icon-20261119T112202Z.dump.cms BACKUP_KEY=backup-key.pem \
  DRILL_DATABASE_URL=postgresql://…/icon_restore_drill infra/scripts/restore-drill.sh
```

Local one-command drill (development only, throw-away keys): `bun run backup:drill:local`.

### Drill log

| Date | Environment | Backup | Result | Restore time | By |
|------|-------------|--------|--------|--------------|----|
| 2026-11-19 | Local development | icon-20261119T112202Z | PASSED — 9 migrations, 13 triggers, row counts matched; tampered file and wrong key correctly rejected | 1 s | Claude Code |
| 2026-11-19 | Local production stack (Phase 12 images) | icon-20261119T160647Z + files archive | PASSED — 10 migrations, 13 triggers, admin present; files archive checksum OK and restored into a new volume | < 1 min | Claude Code |

## 6. Monitoring and alerts (_TBD with host_)

- Alert on: `/health/ready` failing, worker not running, notifications in `DEAD` state, repeated
  `auth.account.locked` / `auth.mfa.failed` audit events, disk/DB storage, backup job failure, last successful
  backup older than 26 hours.
- Logs are structured and redacted (no passwords, tokens, OTPs or message content).

## 7. Performance baseline

`bun run test:perf` seeds ~50,000 jobs (3 branches, 12 months) into the test database and times the main read
endpoints (budget 1.5 s each). Baseline on a development laptop, 2026-11-19:

| Endpoint | Time |
|----------|------|
| Dashboard (all branches / one branch) | 32 ms / 19 ms |
| Job register page 1 / page 200 (12 months) | 17 ms / 91 ms |
| Technician performance (12 months) | 37 ms |
| Outstanding | 9 ms |
| Collections (12 months) | 46 ms |
| Job list / search by number / by phone | 9 ms / 65 ms / 67 ms |
| Customer search by name | 16 ms |

## 8. Open items (Phase 12)

- Hosting, region/data residency, domain/TLS/HSTS, DNS for email (SPF/DKIM/DMARC).
- RPO/RTO targets (owner question 52) → backup frequency and PITR settings.
- Redis-backed rate limiting before running more than one API instance.
- First production admin created securely (no seed credentials), MFA enrolled immediately.
