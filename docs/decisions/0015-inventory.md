# 0015 — Inventory, stock ledger and job parts

- **Status:** Approved for implementation (owner: "phase 6 start", 2026-11-18). Defaults below were proposed to
  the owner (D39, data import, pricing source) and are configurable.
- **Date:** 2026-11-18

## Catalogue

- `parts` per organization: SKU (unique per org, upper-case), name, description, category, unit, default reorder
  level, selling price (NUMERIC(19,4), optional), tax category **placeholder** (null until Phase 7), active flag.
- `suppliers` (optional): name and contact details. No purchase orders in release one.
- No bulk import in this phase (**default**); a CSV import can be added when a parts list is supplied.

## Stock ledger

- `branch_stock (branch, part)` holds `on_hand` and `reserved` (NUMERIC(19,4)) plus an optional branch reorder level.
- Every change is an append-only `stock_movements` row with signed `on_hand_delta` and `reserved_delta`, reason,
  actor, job/reference, unit cost snapshot (receipts) and supplier. The stock row and its movement are written in
  the **same transaction**; the reconciliation endpoint and tests check `on_hand = Σ on_hand_delta` and
  `reserved = Σ reserved_delta` for every row.
- Movement types: `RECEIVE`, `ADJUST`, `TRANSFER_OUT`, `TRANSFER_IN`, `RESERVE`, `RELEASE`, `CONSUME`, `RETURN`.
- Stock is changed with a single conditional `UPDATE … WHERE on_hand − reserved >= :qty` so concurrent requests
  cannot oversell. **Negative stock is refused** unless the actor holds `inventory.negative_override` and gives a
  reason; the movement is flagged and audited.
- Transfers between branches require access to both branches and write paired movements.

## Job parts

- `job_parts` per job and part: reserved, consumed and returned quantities plus removed/defective part details
  (description, serial, disposition: returned to customer, sent to vendor, scrapped, kept for warranty claim).
- Reserve from diagnosis onwards; consume only while the repair is underway (`WAITING_FOR_PARTS`,
  `REPAIR_IN_PROGRESS`, `QUALITY_CHECK`); return unused consumed parts to stock; release reservations.
  Technicians must be assigned (ADR 0013). Closing a job (delivered/cancelled) does not auto-release reservations
  in this phase — the job page shows open reservations to release.

## Pricing

- Estimate part lines can be pre-filled from the catalogue (SKU, description, selling price) as a **copy**; estimates
  never reference live catalogue prices (CLAUDE.md §4.6). Invoices (Phase 7) will snapshot the same way.
