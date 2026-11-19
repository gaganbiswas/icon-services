# Production deployment guide (Phase 12)

> Status: prepared and tested locally; **not live** (ADR 0020). Follow this on a staging server first, then on
> production after the go-live checklist (§8) is signed.

## 1. What runs where

| Container | Purpose | Reachable from internet |
|-----------|---------|-------------------------|
| `edge` (Caddy + staff panel files) | HTTPS, headers, routing | **Yes** (80, 443) |
| `api`, `worker` | API and notification worker (same image) | No |
| `web` | Customer portal (Next.js) | No (via edge) |
| `postgres`, `redis`, `s3` | Data stores | No |

Domains (examples): `staff.<domain>` (staff panel), `api.<domain>`, `service.<domain>` (customer portal),
`files.<domain>` (signed downloads).

## 2. Server preparation (once)

1. VPS in an Indian region; Ubuntu LTS; automatic security updates; SSH keys only; firewall allowing only 22 (your IP),
   80 and 443.
2. Install Docker Engine + Compose plugin. Clone the repository to `/opt/icon` (read-only deploy key).
3. DNS: A/AAAA records for the four sub-domains → the VPS. Email DNS (SPF/DKIM/DMARC) per your SMTP provider.
4. Secrets (`/etc/icon/production.env`, `chown root:root`, `chmod 600`), from `deploy/production/production.env.example`:
   ```bash
   openssl rand -base64 48   # JWT_ACCESS_SECRET, OTP_PEPPER (each separately)
   openssl rand -base64 32   # MFA_ENCRYPTION_KEY
   openssl rand -hex 24      # S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY, POSTGRES_PASSWORD, REDIS_PASSWORD
   ```
   Keep copies in the owner's password manager. Losing `MFA_ENCRYPTION_KEY` forces MFA resets for everyone.
5. Compose variables (`/opt/icon/deploy/production/.env`, also `chmod 600`):
   `IMAGE_TAG`, `ENV_FILE=/etc/icon/production.env`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `ACME_EMAIL`, `ADMIN_DOMAIN`,
   `API_DOMAIN`, `PORTAL_DOMAIN`, `FILES_DOMAIN`.
6. Backup key pair on an **offline** machine (`docs/deployment-runbook.md` §4); copy only the public
   `backup-recipient.pem` to `/etc/icon/`.

## 3. Build and release

```bash
IMAGE_TAG=2026-11-19.1 API_DOMAIN=api.example.com PORTAL_DOMAIN=service.example.com deploy/production/build-images.sh
```

Build on a trusted machine or CI, push to a private registry (`IMAGE_REGISTRY`), or build on the server.
Never reuse a tag for different code.

## 4. First deployment

```bash
cd /opt/icon
C="docker compose -f deploy/production/compose.yml --env-file deploy/production/.env"
$C up -d postgres redis s3
$C run --rm migrate          # prisma migrate deploy
$C run --rm ensure-bucket    # private storage bucket
$C up -d                     # edge, api, worker, web
ORG_CODE=… ORG_DISPLAY_NAME=… ORG_TIMEZONE=… BRANCH_CODE=… BRANCH_NAME=… ADMIN_EMAIL=… ADMIN_FULL_NAME=… \
  ADMIN_PANEL_URL=https://staff.example.com \
  $C run --rm -e ORG_CODE -e ORG_DISPLAY_NAME -e ORG_TIMEZONE -e BRANCH_CODE -e BRANCH_NAME \
     -e ADMIN_EMAIL -e ADMIN_FULL_NAME -e ADMIN_PANEL_URL first-admin
```

Open the printed one-time link (24 h), set the password, then set up two-step sign-in. Configure business details,
currency, numbering, notification templates and staff users in the admin panel. **No demo or UAT data in
production.**

## 5. Updates

1. Backup (`deploy/production/backup-all.sh`), then build the new tag.
2. `IMAGE_TAG=<new>` in `.env` → `$C run --rm migrate` → `$C up -d`.
3. `deploy/production/smoke-test.sh` (§7). Rollback = previous tag; migrations are forward-only (restore the
   pre-release backup if a migration must be undone).

## 6. Backups and recovery (RPO 24 h / RTO 1 day)

- Install the timer: copy `deploy/production/systemd/icon-backup.{service,timer}` to `/etc/systemd/system/`,
  create `/etc/icon/backup.env` (`BACKUP_DIR`, `BACKUP_CERT`, `ENV_FILE`, `OFFSITE_COMMAND`), then
  `systemctl enable --now icon-backup.timer`.
- Off-site copy must go to a second location **in India** (`OFFSITE_COMMAND`, e.g. an rclone remote).
- Monthly drill: `infra/scripts/restore-drill.sh` on a scratch database (`docs/deployment-runbook.md` §5).
- **Disaster recovery:** new VPS (§2) → `$C up -d postgres redis s3` → restore the latest database dump with
  `pg_restore` into the empty database → restore files (`openssl cms -decrypt … | docker run -i -v icon_s3-data:/data
  alpine tar -C /data -xf -`) → `$C up -d` → smoke test. Target: within one working day.

## 7. Smoke test

```bash
ADMIN_DOMAIN=… API_DOMAIN=… PORTAL_DOMAIN=… FILES_DOMAIN=… deploy/production/smoke-test.sh
SMOKE_FROM_OUTSIDE=1 …   # from another network: also checks database/storage ports are closed
```

Read-only checks: health, readiness, docs disabled, authentication required, TLS + HSTS + CSP + frame protection,
HTTP→HTTPS redirect, SPA routing, CORS incl. `Idempotency-Key`, file domain refuses writes and unsigned reads.

## 8. Go-live checklist (sign before switching DNS to production)

| # | Item | Owner | Done |
|---|------|-------|------|
| 1 | UAT checklist signed (`docs/uat/uat-checklist.md`) | Owner | |
| 2 | Phase 7 invoicing approved by the accountant (GST/non-GST, numbering, wording) | Owner / accountant | |
| 3 | Legal entity, address, logo, terms, authorised signatory entered in settings | Owner | |
| 4 | Currency and time zone confirmed and set | Owner | |
| 5 | Domain + DNS records; certificates issued (smoke test passes without `SMOKE_INSECURE`) | Owner / IT | |
| 6 | SMTP sender domain verified; SPF, DKIM, DMARC published | Owner / IT | |
| 7 | Meta WhatsApp: business verified, templates approved, webhook subscribed | Owner | |
| 8 | Secrets generated, stored in password manager; env files `chmod 600` | IT | |
| 9 | Backup timer enabled; off-site copy in India working; restore drill passed on the server | IT | |
| 10 | Privacy policy, consent wording, retention rules approved | Owner / legal | |
| 11 | First admin created via `first-admin`; MFA enrolled; no demo/UAT/test data present | Owner | |
| 12 | Monitoring / uptime alerts set (health URL, backup age, disk) | IT | |
| 13 | Staff trained with `docs/training/` | Owner | |

Signed: ____________________ (owner)  Date: __________
