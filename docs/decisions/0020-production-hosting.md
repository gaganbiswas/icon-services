# 0020 — Production hosting: Linux VPS + Docker, India, RPO 24 h / RTO 1 day

- **Status:** Approved (owner, 2026-11-19): VPS + Docker; data in India; RPO 24 h / RTO 1 day; prepare and test on
  staging, **do not go live** until Phase 7 (invoicing) and UAT sign-off.
- **Date:** 2026-11-19

## Decisions

1. **One Linux VPS in an Indian region** (e.g. Mumbai) runs everything with Docker Compose
   (`deploy/production/compose.yml`): Caddy edge, API, worker, customer portal, PostgreSQL 17, Redis, SeaweedFS.
   Provider is the owner's choice; minimum suggested 4 vCPU / 8 GB RAM / 160 GB SSD (Chromium PDFs + database).
2. **Only Caddy is reachable from the internet** (80/443). It obtains Let's Encrypt certificates automatically,
   redirects HTTP→HTTPS, adds HSTS and security headers, a strict Content-Security-Policy for the staff panel,
   and exposes storage only for signed GET/HEAD downloads on a separate files domain.
3. **Four sub-domains** of the business domain (names are the owner's choice): staff panel, API, customer
   portal, files. Frontend images are built per environment because they embed the API address.
4. **Secrets** in a root-owned `chmod 600` env file on the server (no managed secrets store on a plain VPS); copies in
   the owner's password manager. Production refuses to start with unsafe settings (mock providers, insecure cookies,
   MFA not enforced, missing keys).
5. **Backups (RPO 24 h):** daily 02:30 IST systemd timer: encrypted DB dump + encrypted archive of stored files
   (CMS AES-256-GCM to an offline recipient key), 35-day retention, then an off-site copy to a **second location in
   India** (provider to be chosen; the script warns until configured). Monthly restore drill.
6. **Recovery (RTO 1 day):** provision a new VPS, install Docker, restore DB + files from the latest backup, deploy
   the same image tag, run the smoke test (`docs/production/README.md` §6).
7. **Images** are pinned (Node 24.22.1, PostgreSQL 17.11, Redis 7.4.11, Caddy 2.11.6, SeaweedFS 4.54, Bun 1.4.4)
   and run as non-root with read-only file systems where possible.
8. **First administrator** is created with `first-admin` (no password; one-time set-up link; refuses if users exist);
   MFA is enforced in production.
9. Go-live is blocked until: Phase 7 accountant approval, UAT sign-off, Meta/SMTP approvals, domain/DNS, business
   details, privacy policy (CLAUDE.md §13).
