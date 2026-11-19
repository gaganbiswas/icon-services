# Known limitations (release candidate, Phase 11)

| Area | Limitation | Why / plan |
|------|-----------|-----------|
| Invoicing and tax | GST invoices, credit notes and the GST summary use owner-approved **defaults** (ADR 0022). Tax rates/HSN-SAC are suggestions until the accountant approves them in settings; e-invoicing (IRN/QR) and e-way bills are not generated; tax-inclusive pricing not supported | Accountant review; enable e-invoicing if turnover requires |
| Customer web portal | Tracking, estimate decisions and documents only; new complaints are raised in the Android app or at reception | ADR 0023; add a web complaint form if wanted |
| Balances | Before a job's invoice is issued, "outstanding" and the delivery balance use the approved estimate | Switches to the invoice automatically once issued (ADR 0022) |
| Stock value | Indicative only (latest purchase cost) | Valuation method to be confirmed by the accountant |
| Currency | INR by default (configurable) | Owner question 11 |
| WhatsApp / email | Built (Meta Cloud API, SMTP) but not live | Needs Meta business verification, approved templates, sender domain + DNS |
| Customer sign-in | Development mock until the WhatsApp authentication template is approved | ADR 0018 |
| Business details on documents | Placeholders (name, address, logo, terms) | Owner questions 7–13, 59 |
| Rate limits | In-memory per API process | Move to Redis before running more than one API instance |
| Payment gateway, iOS app, partial delivery | Not in release one | Not confirmed / not enabled |
| Hosting, backups schedule, monitoring | Scripts and runbook ready; schedule and alerts depend on the host | Phase 12 |
| Mobile app E2E | Unit/component tests only | Needs a device farm or emulator in CI |
