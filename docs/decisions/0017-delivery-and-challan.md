# 0017 — Delivery, hand-over and delivery challan

- **Status:** Approved for implementation (owner: "start phase 9", 2026-11-18). Defaults below were proposed to the
  owner (questions D35, D36, D30) and are configurable.
- **Date:** 2026-11-18

## Modes and flow

- Modes: `CUSTOMER_PICKUP | HOME_DELIVERY | ON_SITE_RETURN | OTHER`.
- Pickup / on-site return: `READY_FOR_DELIVERY → DELIVERED` through the **hand-over** action.
- Home delivery: **dispatch** (`READY_FOR_DELIVERY → OUT_FOR_DELIVERY`, address snapshot, challan number issued so the
  challan travels with the goods), then hand-over (`→ DELIVERED`) or **failed attempt** (`→ READY_FOR_DELIVERY`, reason).
- `DELIVERED` is reachable only through the hand-over (ADR 0013); the generic transition endpoint refuses it.

## Mandatory hand-over record (CLAUDE.md §4.9)

- Recipient name and relationship (`SELF | AUTHORIZED_PERSON | FAMILY | COLLEAGUE | OTHER`); an authorization note is
  required unless the recipient is the customer.
- Items: the device plus every accessory recorded at intake, each confirmed returned with its condition.
  **Partial delivery is not allowed** (default for D36) — every item must be returned.
- Proof: `SIGNED_CHALLAN` (customer signs the printed challan) or `PHOTO_PROOF` (uploaded photo required).
- Hand-over checklist (device tested in front of the customer, data/accessories checked) and condition notes.
- Completion is idempotent (`Idempotency-Key`) and runs in one transaction: delivery record, items, job status,
  release of any open part reservations, audit, and a `DELIVERY_CONFIRMED` notification.

## Balance due (interim until invoicing)

- Until Phase 7 invoices exist: **due = approved estimate customer-payable − net payments recorded for the job**
  (payments minus refunds, reversed excluded). No approved estimate ⇒ due = 0.
- If due > 0, hand-over requires `deliveries.due_override` (**default:** Branch Admin, Super Admin) and a reason; the
  override, approver and amounts are stored on the delivery and audited. Phase 7 replaces the interim figure with the
  invoice balance.

## Delivery challan

- Unique number per branch (setting `numbering.challanNumber`, **PLACEHOLDER** `DC-{BRANCH}-{YYYY}-{SEQ:6}`).
- PDF contents: branch details, customer snapshot, job number, device and serial number, items returned, delivery date,
  balance status, recipient, signature fields, and the statement that it is **a hand-over document — not an invoice and
  not proof of payment**. Stored immutably like other documents.
- Challan terms text is a setting (**PLACEHOLDER** until supplied, H59).
