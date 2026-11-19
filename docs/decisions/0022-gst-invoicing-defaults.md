# 0022 — GST invoicing with owner-approved defaults (Phase 7)

- **Status:** Approved by owner ("keep the other answers as defaults and finish everything", 2026-11-19).
  Every default below is a **setting**, not code, and must be reviewed by the accountant before production billing.
- **Date:** 2026-11-19

## Safeguard (CLAUDE.md §4.7, §11.4)

Tax **rates and HSN/SAC codes are not hard-coded**. The tax setting ships as **DRAFT** with clearly marked *suggested*
categories. **Invoices cannot be issued** until a user with `settings.manage` sets the tax configuration to
`APPROVED`, recording who approved it (e.g. the accountant's name) and when — audited. Changing an approved
configuration later is also audited; issued invoices keep their snapshot and never change.

## Defaults (owner questions 11–27a)

| Q | Topic | Default |
|---|-------|---------|
| 11 | Currency | INR (setting `money.currency`) |
| 12 | Time zone | Asia/Kolkata (organisation setting) |
| 13 | Financial year | 1 April – 31 March (`invoicing.financialYearStartMonth = 4`) |
| 17 | Rates / HSN-SAC | *Suggested, unapproved:* Services & labour — SAC 998713, 18 %; Spare parts — HSN 8473, 18 %. Line types map to categories (LABOUR, SERVICE_FEE, OTHER → SERVICE; PART → PARTS); a part's own tax category overrides. |
| 18 | Place of supply | Recipient state from customer GSTIN (first two digits), else billing/service address state, else the business's state. Same state as the business → CGST + SGST (rate split equally); different → IGST. |
| 19 | Prices | Tax-exclusive (GST added on top of estimate/invoice prices). |
| 20 | Rounding | Each tax component per line rounded half-up to paise; invoice grand total rounded half-up to the nearest rupee, shown as a separate "Round off" line. |
| 21 | E-invoicing / e-way bill | Off (not generated). Fields can be added when applicable. |
| 22 | Reverse charge | Never; invoices print "Reverse charge: No". |
| 23 | Mandatory fields | GST invoice contents: supplier name/address/GSTIN, invoice number (≤ 16 characters, unique per financial year) and date, recipient name/address (+ GSTIN if registered), place of supply (state name and code), HSN/SAC, description, quantity, unit, rate, discount, taxable value, CGST/SGST/IGST rate and amount, totals, amount in words, reverse-charge statement, signature block "For ICON INFOSYS — Authorised Signatory". Terms/declaration text is a setting (placeholder until supplied). |
| 24 | Numbering | Invoice `INV-{FYS}-{SEQ:6}` → e.g. `INV-2627-000001` (15 characters), one series for the GSTIN, restarts each financial year. Credit note `CN-{FYS}-{SEQ:6}`. |
| 25 | Corrections | Issued invoices are never edited or deleted. Corrections by **credit note** (whole invoice = cancellation, or selected lines/quantities), with reason, permission `credit_notes.issue` (held by Accounts; makes two-step sign-in mandatory), audited. |
| 26 | Warranty jobs | Only customer-payable lines are invoiced; warranty/goodwill lines are not charged. No invoice when nothing is payable. |
| 27a | Advances | Payments before the invoice stay on the customer's account and are **allocated automatically** to the job's invoice when it is issued (and later payments to open invoices). Receipt footer remains a setting. |

## Balances after invoicing

- Invoice balance = total − credited − active allocations. Status: unpaid / partly paid / paid; credit beyond the
  allocations frees the excess (released allocations), which then shows as money on account (refundable).
- Job balance (delivery, outstanding report, dashboard) uses issued invoices when the job has any, otherwise the
  approved-estimate interim basis (ADR 0017/0019).
- Bounced cheque after allocation: release the allocation (reason, audited), then reverse the payment.
