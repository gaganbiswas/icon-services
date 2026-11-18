# 0016 — Payments, refunds, reversals and receipts (before invoicing)

- **Status:** Approved for implementation (owner: "start 8", 2026-11-18). Phase 7 (invoicing) is blocked on written
  tax confirmation, so payments are recorded **on the customer's account** now and allocated to invoices in Phase 7.
- **Date:** 2026-11-18

## Payments

- One `payments` row per amount received (split payments = several rows, e.g. part cash, part UPI). Linked to a
  customer, branch and optionally a job. Money `NUMERIC(19,4)`; currency is the configured business currency
  (never assumed — `CONFIGURATION_REQUIRED`).
- Methods `CASH | UPI | BANK_TRANSFER | CARD_TERMINAL | CHEQUE | OTHER`; enabled set is a setting (**default: all**,
  owner question D38). No payment gateway (separate approval). A reference is required for every method except cash.
- **No card or banking secrets:** references that look like a full payment-card number (13–19 digits passing the
  Luhn check) are rejected. Never store card numbers, CVV, banking passwords or UPI PINs (CLAUDE.md §4.8).
- Recording is idempotent (`Idempotency-Key`). Received time may be back-dated up to 30 days, never future.
- Receipt numbers from the numbering service (setting `numbering.receiptNumber`, **PLACEHOLDER**
  `RCPT-{BRANCH}-{YYYY}-{SEQ:6}`); refund numbers `numbering.refundNumber` (**PLACEHOLDER** `RFD-{BRANCH}-{YYYY}-{SEQ:6}`).
- Core payment fields are immutable (database trigger). Payments are never deleted.

## Balances

- Each payment tracks `allocated_total` (always 0 until Phase 7) and `refunded_total`.
  `on_account = amount − allocated − refunded` for non-reversed payments; CHECKs keep this non-negative.
- Customer account summary and collection reports are computed from these rows; tests reconcile them under partial
  payment, overpayment (unallocated money stays on account), refunds and reversals.
- Invoice payment status (unpaid / partially paid / paid / overpaid) is derived from allocations in Phase 7.

## Refunds and reversals

- **Refund** (money returned): `payments.refund`, reason, method, reference (except cash), amount ≤ refundable
  on-account amount; append-only `payment_refunds` with its own number.
- **Reversal** (payment recorded in error, bounced cheque): `payments.refund`, reason, only when nothing is allocated
  or refunded; the payment is marked `REVERSED` (kept, excluded from balances).
- Both are audited.

## Receipts

- Payment receipt PDF via the document pipeline (immutable snapshot, reprints unchanged).
- Footer wording is a setting; **PLACEHOLDER** "Tax treatment of this payment to be confirmed." shown visibly until the
  accountant confirms whether a GST receipt voucher (or other wording) is required (new owner question C27a).
- Customers can list and download their own receipts.
