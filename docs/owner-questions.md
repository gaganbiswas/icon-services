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

7. Legal registered name of the business and trading/display name. _answer_
8. Legal entity type (proprietorship, partnership, LLP, private limited, other). _answer_
9. Registered address and business/service-centre address(es), including
   country, state, PIN/postal code. _answer_
10. Business phone, email, website. _answer_
11. Default currency (do not assume INR). _answer_
12. Time zone. _answer_
13. Financial year start/end (e.g. 1 April – 31 March?). **[ACCOUNTANT]** _answer_

## C. Tax and invoicing **[ACCOUNTANT]**

14. Is the business GST-registered? GSTIN(s) per state/branch? _answer_
15. Composition scheme or regular scheme? _answer_
16. In what situations should a **NON_GST** invoice be issued, and what exact
    legal wording must appear on it (e.g. "Bill of Supply" or other)? _answer_
17. Tax rates applicable to: labour/service charges, spare parts, on-site
    visit charges, diagnostic fees. With HSN/SAC codes for each. _answer_
18. Place-of-supply rules to apply (intra-state CGST+SGST vs inter-state IGST)
    — and for on-site service at a customer address? _answer_
19. Prices entered tax-inclusive or tax-exclusive? Can it differ per line? _answer_
20. Rounding rules: per line or per invoice; round-off to nearest rupee/unit
    shown as a separate line? _answer_
21. Is e-invoicing (IRN/QR) applicable based on turnover? E-way bill for
    device delivery? _answer_
22. Is reverse charge ever applicable? _answer_
23. Mandatory invoice fields and exact wording, terms, declaration, and
    authorized signatory name/designation. _answer_
24. Invoice numbering format and series (per branch? per financial year?
    separate series for GST and non-GST?). Max length 16 chars if Indian GST applies. _answer_
25. Credit-note and invoice-cancellation process the accountant requires. _answer_
26. Warranty repairs: how are manufacturer-reimbursed or zero-charge warranty
    jobs invoiced (zero-value invoice, no invoice, claim document)? _answer_
27. Can the accountant provide a set of **sample invoices with expected
    totals** to use as test vectors? _answer_

## D. Operations and policies

28. Number of branches now, and expected within 12 months? Branch codes/names. _answer_
29. Job number format (e.g. `BR1-2026-000123`)? Reset yearly? _answer_
30. Receipt and delivery challan number formats. _answer_
31. Staff list by role for initial setup (names only; no passwords). _answer_
32. Warranty rules: who verifies, what proof is accepted, what is excluded
    (physical/liquid damage etc.)? _answer_
33. Is a diagnostic/inspection fee charged? Can it be charged without
    estimate approval? _answer_
34. Estimate validity period, and what happens on rejection (return device
    unrepaired, charge diagnostic fee?). _answer_
35. Is delivery allowed with balance due? Which roles may approve? _answer_
36. Is partial delivery (e.g. returning some accessories/items) needed? _answer_
37. Unclaimed-device policy (days before reminders/storage charges)? _answer_
38. Payment methods to enable: cash, UPI, bank transfer, card terminal,
    cheque, other? Any limit on cash amounts? _answer_
39. Is inventory tracked today? Number of SKUs, suppliers to track? Existing
    data to import (customers, parts, open jobs) — format? _answer_
40. Thermal receipt printer model/paper width (58 mm / 80 mm), or A4 only? _answer_

## E. Languages and customer experience

41. Languages for staff UI, customer app, documents, and messages
    (English only? plus Hindi/Bengali/other?). _answer_
42. How will customers sign in to the Android app (mobile OTP, email+password,
    both)? _answer_
43. Customer app distribution: Google Play Store (needs developer account) or
    direct APK? _answer_
44. Can customers raise complaints via the app without visiting the centre
    (and then bring/ship the device), or app is tracking-only at first? _answer_

## F. Providers **(do not choose on your behalf)**

45. OTP/SMS provider (e.g. MSG91, Twilio, Firebase Auth, other) and whether
    DLT registration (India) is done. _answer_
46. WhatsApp: do you have a WhatsApp Business Platform account / Meta
    Business verification? Preferred provider (Meta Cloud API direct, or a BSP
    such as Gupshup, Twilio, Interakt, other)? Business phone number to use. _answer_
47. Transactional email provider (Amazon SES, Postmark, SendGrid, Resend,
    other) and sender domain. Do you control the domain's DNS? _answer_
48. Online payment gateway: confirm **out of scope** for release one? _answer_

## G. Hosting, security, data

49. Hosting preference (AWS, Azure, GCP, DigitalOcean, Indian cloud provider,
    on-premises server) and monthly budget range. _answer_
50. Data residency requirement (must data stay in India / a specific country?). _answer_
51. Domain names for web app and API. _answer_
52. Acceptable data loss (RPO) and downtime (RTO) — e.g. 15 min / 4 hours. _answer_
53. Data retention periods: customer data, job records, invoices (tax law may
    require years), photos, message logs. **[ACCOUNTANT/LEGAL]** _answer_
54. Do you have a privacy policy, terms of service, and consent wording, or
    do these need to be drafted for legal review? _answer_
55. MFA for admin/accounts staff: authenticator app (TOTP) acceptable? _answer_

## H. Branding and documents

56. Logo files (SVG/PNG high-res), brand colours, fonts. _answer_
57. Text for job receipt terms & conditions (liability, unclaimed devices,
    data-loss disclaimer). _answer_
58. Text for estimate, invoice, delivery challan terms; signature blocks. _answer_
59. Paper sizes: A4 for invoice/challan; thermal for job receipt? _answer_
