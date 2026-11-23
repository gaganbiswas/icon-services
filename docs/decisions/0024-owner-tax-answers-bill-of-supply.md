# ADR 0024 — Owner's tax answers; Bill of Supply chosen per invoice; zero-value invoices

- Status: Approved (owner answers 2026-11-21)
- Date: 2026-11-21
- Supersedes: the "GST invoices only" rule of ADR 0021; the defaults in ADR 0022 listed below

## Owner answers (questions 7–27a)

| Q | Answer | What the system does |
|---|--------|----------------------|
| 7 | ICON INFOSYS | Legal name in the business profile |
| 8 | Proprietorship | Recorded (no system effect) |
| 9 | MIG-7, Nilganj Road, Sodepur, Kolkata 700110 | The answer said 700 100; the owner confirmed **700110** |
| 10 | 9903276666, 9330522205, info@iconinfosys.co.in, www.iconinfosys.co.in | Phones/email/website printed on documents (entered in Settings → Business) |
| 11 | INR | `money.currency = INR` |
| 12 | +05:30 | Organisation time zone Asia/Kolkata |
| 13 | April to March | `invoicing.financialYearStartMonth = 4` |
| 14–15 | 19AHDPB5074F1ZK, regular | Unchanged |
| 16 | "Supply" → staff choose per invoice | **Bill of Supply** option, below |
| 17 | 18 %; codes confirmed 2026-11-23 | Services/labour SAC 998713 and parts HSN 8473, both 18 % |
| 18 | CGST+SGST same state, IGST otherwise | As built (ADR 0022) |
| 19 | GST added on top (confirmed) | Tax-exclusive prices |
| 20 | Yes | Total rounded to the nearest rupee with a "Round off" line |
| 21 | No | No e-invoice (IRN/QR), no e-way bill |
| 22 | No | No reverse charge ("Reverse charge: No") |
| 23 | Normal terms; signatory "For Icon Infosys" | Default terms: no returns/exchange, warranty on parts per manufacturer (physical/liquid/burn damage excluded), payment due on delivery, subject to Kolkata jurisdiction, E. & O.E.; standard declaration ("actual price … true and correct"); signature block "For ICON INFOSYS / Authorised Signatory" (no personal name). All editable in Settings → Business and invoicing |
| 24 | MT/<number>, restart each April (confirmed) | Tax invoices `MT/{FYS}/{SEQ:1}` → `MT/2627/1`; Bill of Supply `BS/2627/1`; credit notes `CN/2627/1` (both chosen to match; changeable in settings) |
| 25 | Yes | Credit-note correction/cancellation process as built |
| 26 | Zero-value invoice | Warranty/no-charge jobs get an invoice; warranty and goodwill lines are listed at ₹0 |
| 27 | No | No accountant sample invoices; tests use our worked examples |
| 27a | No | No GST receipt voucher; payment receipts print no tax footer (empty by default) |


## Bill of Supply

- Each invoice has `document_type` = `TAX_INVOICE` (default) or `BILL_OF_SUPPLY`. Accounts staff choose it on
  the draft; a Bill of Supply requires a reason, which is stored on the invoice and in the audit log.
- A Bill of Supply charges no GST (lines keep HSN/SAC, rate 0). A database CHECK refuses a Bill of Supply with
  any CGST/SGST/IGST; the type and reason are frozen once issued (trigger).
- Own number series `numbering.billOfSupplyNumber` (default `BS/{FYS}/{SEQ:1}`).
- PDF titled "Bill of Supply", no GST columns, totals or GST summary, "No GST charged".
- The GST summary report excludes Bills of Supply (and their credit notes) from every GST figure and reports
  them on a separate line.
- **Rule (owner, 2026-11-23): a Bill of Supply is used whenever staff select it for an invoice.** The system adds no
  automatic conditions; the required reason and the audit record are the controls.

## Zero-value invoices

- Drafts include every approved estimate line; warranty lines get "(covered by warranty)", goodwill lines
  "(no charge)", both at ₹0. Issued invoices may total ₹0 (database rule relaxed to `total >= 0`).
- A ₹0 invoice shows as paid (nothing due). It can only be cancelled as a whole, by a ₹0 credit note; every
  other credit note must be positive (database rule).
- The HSN summary quantities include zero-value items.

## Still required before production

The tax configuration stays **unapproved until someone records the approval** in Settings → Business and
invoicing (who and when). Rates and HSN/SAC codes are confirmed by the owner.
