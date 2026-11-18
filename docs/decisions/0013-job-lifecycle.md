# 0013 — Job lifecycle, technician work and notification outbox

- **Status:** Approved for implementation (owner: "start phase 4", 2026-11-18). Defaults below were proposed
  to the owner and remain configurable.
- **Date:** 2026-11-18

## Status transitions

- One domain service performs every status change; the matrix lives in `packages/contracts/src/lifecycle.ts`
  and is covered by tests. Each change appends `job_status_history` (from, to, actor, channel, reason,
  customer message) in the same transaction as the job update and outbox event.
- Reasons are mandatory for: hold, cancel, reopen, failed quality check, sending a job back a step.
- `ON_HOLD` resumes only to the status the job was in before the hold.
- **Receive device** (`AWAITING_DEVICE → RECEIVED`) is a dedicated action recording checklist, accessories,
  condition, photos and acknowledgement (owner default).
- **Approval before repair:** transitions out of `AWAITING_CUSTOMER_APPROVAL` into repair/parts require an
  approved estimate (Phase 5). Until then they are rejected with `ESTIMATE_APPROVAL_REQUIRED`.
- **Completion:** `QUALITY_CHECK → REPAIR_COMPLETED` requires a repair summary and a fully passed
  quality-control checklist.
- **Delivery:** `→ DELIVERED` is not available through the generic transition endpoint; it is reached only by the
  delivery workflow with a hand-over record (Phase 9).
- **Reopen** (`DELIVERED`/`CANCELLED → RECEIVED`) requires `jobs.reopen` and a reason (default: Branch Admin, Super Admin).
- Optimistic concurrency: transition requests carry the job `version`.

## Technician scope

- Technicians may read branch jobs, but may change status, add diagnoses, work logs and attachments only on jobs
  currently assigned to them, unless they hold `jobs.assign` (managers).
- Internal notes (diagnosis internal notes, INTERNAL work logs) are returned only to holders of
  `jobs.internal_notes.read`, and never by customer endpoints.

## Notifications (provider mocked)

- Customer-relevant events (job received, customer-visible status change, repair completed, ready, customer-visible
  update) are written to `notification_outbox` in the business transaction, with an idempotency key.
- A worker process (`apps/api` `worker` entry) claims due rows with `FOR UPDATE SKIP LOCKED`, checks active consent
  per channel, calls channel adapters (mock WhatsApp and email in this phase), records `notification_deliveries`,
  retries with exponential backoff (max 5 attempts) then marks `DEAD`. Authorized staff can retry.
- Provider acceptance is recorded as `ACCEPTED`, never `DELIVERED` (CLAUDE.md §11.15); delivery status arrives via
  provider callbacks in Phase 10. BullMQ will be introduced with real providers in Phase 10; the outbox is the
  source of truth either way.
- Message bodies are not logged; templates are placeholders pending approved WhatsApp templates.
