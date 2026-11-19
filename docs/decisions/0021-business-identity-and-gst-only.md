# 0021 — Business identity; GST invoices only (regular scheme)

- **Status:** Approved (owner, 2026-11-19)
- **Date:** 2026-11-19

## Decisions

1. **Business:** ICON INFOSYS, MIG-7, Nilganj Road, Sodepur, Kolkata 700110 (West Bengal, India). Contact Uttam
   Biswas; phones 98303 77112, 93305 22205, 98301 85448, 99032 76666; info@iconinfosys.co.in,
   uttam@iconinfosys.co.in.
2. **GST:** registered under the **regular** scheme, GSTIN **19AHDPB5074F1ZK** (state code 19 = West Bengal; format and
   check digit validated). PAN AHDPB5074F indicates a proprietorship (to be confirmed, owner question 8).
3. **Only GST invoices.** No non-GST / bill-of-supply mode is built. This **narrows CLAUDE.md §1/§4.7** ("Billing modes:
   GST and Non-GST") by owner decision. The invoice model keeps a tax-mode field so a second mode could be added later
   without schema changes, but no non-GST wording or numbering series exists.
4. These details are **configuration, not code**: they are entered when the production organisation and branch are
   created (`first-admin`) and in the business-profile settings. They are never put into UAT/sample data.

## Still required before invoicing (Phase 7) — accountant

Tax rates with HSN/SAC per item type (Q17), place of supply incl. on-site and inter-state customers (Q18), tax-inclusive
or exclusive prices (Q19), rounding (Q20), e-invoicing / e-way bill applicability (Q21), reverse charge (Q22), mandatory
fields + wording + authorised signatory (Q23), invoice number format (Q24, max 16 characters), credit notes /
cancellation (Q25), warranty-job documentation (Q26), sample invoices with expected totals (Q27), advance receipt
vouchers (Q27a), financial year (Q13). Also confirm currency INR (Q11) and time zone Asia/Kolkata (Q12).

## Gap noted

The admin panel has no screen yet to edit the organisation's legal name, GSTIN, address and contact details or a
branch's address. Phase 7 adds a **business profile** (organisation + branch, with GSTIN validation) because invoices
must print them.
