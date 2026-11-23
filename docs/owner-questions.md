# Owner Questions — must be answered before implementation

Answer inline (replace `_answer_`). Items marked **[BLOCKS PHASE 1]** must be
answered before any code is written. Items marked **[ACCOUNTANT]** need written
confirmation from the business's accountant / tax professional.

## A. Scope and platform

1. **[BLOCKS PHASE 1]** "Web/Desktop": is a responsive website used in desktop
   browsers sufficient, or do you also need an installable desktop app
   (Windows/macOS)? **Website only; no desktop app.**
2. **[BLOCKS PHASE 1]** May I update `CLAUDE.md` §3 to say "Bun workspaces"
   instead of "pnpm workspaces" so the project rules match your instruction? **Yes — done 2026-11-18.**
3. **[BLOCKS PHASE 1]** Approve running the API on Node.js LTS with Bun as the
   package manager (ADR 0006), or must the API also run on the Bun runtime? **Approved: Node.js LTS runtime.**
4. **[BLOCKS PHASE 1]** The folder is not a git repository. May I run
   `git init` and create an initial commit in Phase 1? Will you host code on
   GitHub/GitLab (needed for the CI pipeline)? **Yes to git init and initial commit.** Hosting not stated; git identity is a GitHub account, so CI is written for GitHub Actions — confirm.
5. Is iOS confirmed out of scope for release one? _answer_
6. Will technicians use the responsive web workspace on phones/tablets
   (no separate technician app in release one)? _answer_
6a. **Android application ID** (e.g. `com.<company>.service`) — permanent once published on Google Play. _answer_
6b. Confirm GitHub as the code host (CI is written for GitHub Actions). _answer_

## B. Legal entity and business profile

Answered by the owner on 2026-11-21 (ADR 0024).

7. Legal registered name of the business and trading/display name. **ICON INFOSYS.**
8. Legal entity type. **Proprietorship.**
9. Registered address and business/service-centre address(es). **MIG-7, Nilganj Road, Sodepur, Kolkata 700110, West Bengal, India** (the written answer said 700 100; the owner confirmed 700110).
10. Business phone, email, website. **9903276666, 9330522205; info@iconinfosys.co.in; www.iconinfosys.co.in** (printed on documents).
11. Default currency. **INR.**
12. Time zone. **+05:30 (Asia/Kolkata).**
13. Financial year start/end. **April to March.**

## C. Tax and invoicing **[ACCOUNTANT]**

Answered by the owner on 2026-11-21 (ADR 0024).

14. GST registration / GSTIN. **Yes — 19AHDPB5074F1ZK (West Bengal).**
15. Composition or regular scheme. **Regular.**
16. When is a Bill of Supply (no GST) issued? **Staff choose per invoice, with a recorded reason.** (Supersedes "GST only" in ADR 0021.) Confirmed 2026-11-23: used whenever staff select it for an invoice.
17. Tax rates. **18 %. HSN/SAC confirmed (2026-11-23): SAC 998713 (services and labour), HSN 8473 (parts).**
18. Place of supply. **CGST + SGST within West Bengal, IGST otherwise.**
19. Tax-inclusive or tax-exclusive prices. **GST added on top (tax-exclusive), all lines.**
20. Rounding. **Yes — total rounded to the nearest rupee, shown as a "Round off" line.**
21. E-invoicing / e-way bill. **No.**
22. Reverse charge. **No.**
23. Mandatory wording, terms, declaration, signatory. **Normal terms and declaration; signature "For ICON INFOSYS — Authorised Signatory"** (2026-11-21). Standard wording in use (editable in settings): no returns/exchange of goods sold, warranty on parts as per manufacturer, payment due on delivery, subject to Kolkata jurisdiction, E. & O.E.; declaration "We declare that this invoice shows the actual price of the goods and services described and that all particulars are true and correct."
24. Invoice numbering. **MT/<number>, restarting each April with the year: `MT/2627/1`.** Bill of Supply `BS/2627/1`, credit notes `CN/2627/1` (chosen to match; changeable).
25. Credit-note / cancellation process. **Yes — as built** (credit note for some lines or the whole invoice, with reason, audited).
26. Warranty / zero-charge jobs. **Zero-value invoice** (warranty lines listed at ₹0).
27. Accountant sample invoices. **No.**
27a. GST receipt voucher for advances / receipt wording. **No** (receipts carry no tax footer).

## D. Operations and policies

28. Number of branches now, and expected within 12 months? Branch codes/names. _answer_ (Development seed uses one placeholder branch `DEV-01`.)
29. Job number format (e.g. `BR1-2026-000123`)? Reset yearly? _answer_ (PLACEHOLDER in use: `{BRANCH}-{YYYY}-{SEQ:6}`, yearly — changeable in settings.)
30. Receipt and delivery challan number formats. _answer_
31. Staff list by role for initial setup (names only; no passwords). _answer_
32. Warranty rules: who verifies, what proof is accepted, what is excluded
    (physical/liquid damage etc.)? _answer_
33. Is a diagnostic/inspection fee charged? Can it be charged without
    estimate approval? _answer_ (Default in use: no diagnostic fee; no repair without approval — ADR 0014.)
34. Estimate validity period, and what happens on rejection (return device
    unrepaired, charge diagnostic fee?). _answer_ (Default in use: 14 days; rejection → return unrepaired with reason.)
34a. May staff record an estimate approval given by phone or in person on the customer's behalf? (Not built — CLAUDE.md lists only app/portal/link.) _answer_
35. Is delivery allowed with balance due? Which roles may approve? _answer_ (Default in use: Branch Admin / Super Admin with reason — ADR 0017.)
36. Is partial delivery (e.g. returning some accessories/items) needed? _answer_ (Default in use: not allowed.)
37. Unclaimed-device policy (days before reminders/storage charges)? _answer_
38. Payment methods to enable: cash, UPI, bank transfer, card terminal,
    cheque, other? Any limit on cash amounts? _answer_ (Default in use: all enabled, no cash limit — ADR 0016.)
39. Is inventory tracked today? Number of SKUs, suppliers to track? Existing
    data to import (customers, parts, open jobs) — format? _answer_ (Built: catalogue, branch stock ledger, optional suppliers; no import yet — ADR 0015.)
40. Thermal receipt printer model/paper width (58 mm / 80 mm), or A4 only? _answer_

## E. Languages and customer experience

41. Languages for staff UI, customer app, documents, and messages
    (English only? plus Hindi/Bengali/other?). _answer_
42. How will customers sign in to the Android app (mobile OTP, email+password,
    both)? _answer_ (Built: mobile OTP through a provider adapter; only a development mock exists.)
43. Customer app distribution: Google Play Store (needs developer account) or
    direct APK? _answer_
44. Can customers raise complaints via the app without visiting the centre
    (and then bring/ship the device), or app is tracking-only at first? _answer_

## F. Providers **(do not choose on your behalf)**

45. OTP/SMS provider (e.g. MSG91, Twilio, Firebase Auth, other) and whether
    DLT registration (India) is done. **WhatsApp authentication template (ADR 0018).**
46. WhatsApp: do you have a WhatsApp Business Platform account / Meta
    Business verification? Preferred provider (Meta Cloud API direct, or a BSP
    such as Gupshup, Twilio, Interakt, other)? Business phone number to use. **Meta Cloud API direct (ADR 0018).** Business verification, phone number and template approval still needed. _answer_
47. Transactional email provider (Amazon SES, Postmark, SendGrid, Resend,
    other) and sender domain. Do you control the domain's DNS? **SMTP (provider by configuration, ADR 0018).** Sender domain + DNS still needed. _answer_
48. Online payment gateway: confirm **out of scope** for release one? _answer_

## G. Hosting, security, data

49. Hosting preference (AWS, Azure, GCP, DigitalOcean, Indian cloud provider,
    on-premises server) and monthly budget range. **Linux VPS + Docker, provider still to choose (ADR 0020).**
50. Data residency requirement (must data stay in India / a specific country?). **India (ADR 0020).**
51. Domain names for web app and API. _answer_
52. Acceptable data loss (RPO) and downtime (RTO) — e.g. 15 min / 4 hours. **24 h / 1 day (ADR 0020).**
53. Data retention periods: customer data, job records, invoices (tax law may
    require years), photos, message logs. **[ACCOUNTANT/LEGAL]** _answer_
54. Do you have a privacy policy, terms of service, and consent wording, or
    do these need to be drafted for legal review? _answer_
55. MFA for admin/accounts staff: authenticator app (TOTP) acceptable? **Yes (2026-11-18) — plan in ADR 0011.**
56. May the system store client IP address and browser/user-agent on sign-in sessions and audit records for security monitoring? (Setting `AUDIT_STORE_CLIENT_METADATA`; legal basis depends on jurisdiction.) _answer_

## H. Branding and documents

57. Logo files (SVG/PNG high-res), brand colours, fonts. _answer_
58. Text for job receipt terms & conditions (liability, unclaimed devices,
    data-loss disclaimer). _answer_
59. Text for estimate, invoice, delivery challan terms; signature blocks. _answer_
60. Paper sizes: A4 for invoice/challan; thermal for job receipt? _answer_
