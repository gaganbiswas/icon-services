# User acceptance testing (UAT) — set-up

UAT uses a **sample organisation** ("Sample Service Centre (UAT data — not a real business)") with fictitious
customers and devices. Never load real customer data into a UAT environment.

## 1. Prepare the environment

```bash
bun install && bun run services:up && bun run build
bun run db:deploy                       # migrations on the UAT database (DATABASE_URL)
export UAT_PASSWORD='choose-a-strong-password'   # shared by all sample users; never a real password
bun run --filter @icon/database db:seed:uat      # organisation, 2 branches, one user per role
node apps/api/dist/main.js &                     # API (MFA_ENFORCEMENT=optional for UAT unless testing MFA)
bun run --filter @icon/api uat:data              # sample jobs, payments, a delivery, stock — via the real API
```

`uat:data` waits automatically when it hits the sign-in rate limit (about one minute). It refuses to run twice.

## 2. Sign-in accounts (all use `UAT_PASSWORD`)

| Login | Role | Branches |
|-------|------|----------|
| `superadmin@uat.example.test` | Super Admin | all |
| `manager@uat.example.test` | Branch Admin / Manager | Central |
| `reception@uat.example.test` | Reception | Central |
| `reception2@uat.example.test` | Reception | North |
| `tech1@uat.example.test` | Technician | Central |
| `tech2@uat.example.test` | Technician | Central, North |
| `accounts@uat.example.test` | Accounts | both |
| `delivery@uat.example.test` | Delivery Staff | Central |
| `auditor@uat.example.test` | Auditor / Read only | both |

## 3. Sample jobs created

| # | Situation | Branch |
|---|-----------|--------|
| 1 | Just received (laptop does not power on) | Central |
| 2 | In diagnosis, warranty claim (printer) | North |
| 3 | Estimate sent, awaiting customer approval | Central |
| 4 | Approved, repair in progress, work log visible to customer | Central |
| 5 | Approved, waiting for parts | Central |
| 6 | Repair completed, part-paid (balance due 2,200) | Central |
| 7 | Ready for delivery, paid in full (cash + UPI) | Central |
| 8 | Delivered (customer pick-up, card payment) | Central |
| 9 | On hold (waiting for warranty proof) | Central |
| 10 | Cancelled (customer bought a new monitor) | Central |
| 11 | Estimate rejected, returning unrepaired | Central |
| 12 | On-site service request for a business customer | Central |

Stock: 4 parts at Central; the battery is below its reorder level.

The sample currency is `XXX` ("no currency") because the real currency is not yet confirmed (owner question 15).
Change it in settings once confirmed.

## 4. Automated checks before each UAT round

`bun run check`, `bun run test:integration`, `bun run test:e2e` (browser walk-through of the full workflow),
`bun run backup:drill:local`.

Then work through [`uat-checklist.md`](uat-checklist.md) and record results and sign-off.
