# Accounts

- **Payments** tab on a job: **Record payment** — amount, method; UPI / bank / card / cheque need the transaction
  reference (never a card number). Split payments are fine: record each one. **Receipt** prints a payment receipt.
- **Refund** and **Reverse** need a reason and are audited; reversed payments stay visible.
- **Reports**: Collections (by method and cashier), Outstanding balances (with aging), Job register — each can be
  exported as CSV, Excel or PDF (exports are logged).
- **Tax invoice** (job → Invoice tab, once the repair is completed): **Prepare tax invoice** copies the approved
  estimate's chargeable lines (warranty lines are free). Adjust lines if needed → **Save and recalculate** → check
  CGST/SGST (customers in West Bengal) or IGST (other states, from the customer's GSTIN or address) → **Issue tax
  invoice**. It gets the next number (e.g. MT/2627/1) and can never be edited.
- **Bill of supply** (no GST): on the draft choose "Bill of supply (no GST)", write why no GST is charged (kept on
  record), **Save and recalculate**, then issue. It is numbered BS/2627/… and printed without GST. Choosing it is your
  decision for that invoice (business rule); the reason you write is kept on the invoice and in the audit log.
- **Warranty jobs**: warranty and goodwill items appear on the invoice at ₹0; a fully warranty job gets a ₹0 invoice.
  A ₹0 invoice can only be cancelled as a whole.
- Payments already taken for the job are applied to the invoice automatically; later payments too.
- Mistakes are corrected with a **Credit note** (some quantities, or the whole invoice to cancel it). Any money paid
  beyond the new balance becomes refundable from the payment.
- **Invoices** (menu) lists every invoice; **Reports → GST summary** gives taxable value and CGST/SGST/IGST by rate and
  HSN/SAC for the period (exportable). Review it with the accountant before filing returns.
