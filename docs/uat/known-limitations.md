# Known limitations (release candidate, Phase 11)

| Area | Limitation | Why / plan |
|------|-----------|-----------|
| Invoicing and tax | No GST / non-GST invoices, credit notes or tax reports | Phase 7 needs written confirmation from the accountant (owner questions 14–27a) |
| Balances | "Outstanding" and delivery balance use the approved estimate minus payments | Interim basis (ADR 0017/0019) until invoices exist |
| Stock value | Indicative only (latest purchase cost) | Valuation method to be confirmed by the accountant |
| Currency | Not configured (sample uses `XXX`) | Owner question 15 |
| WhatsApp / email | Built (Meta Cloud API, SMTP) but not live | Needs Meta business verification, approved templates, sender domain + DNS |
| Customer sign-in | Development mock until the WhatsApp authentication template is approved | ADR 0018 |
| Business details on documents | Placeholders (name, address, logo, terms) | Owner questions 7–13, 59 |
| Refund / reverse / unassign / failed delivery reasons | Entered in the browser's prompt box | Replace with proper dialogs (usability) |
| Users and roles screens | Managed through the API; no admin screens yet | Planned UI work; MFA reset is API-only |
| Rate limits | In-memory per API process | Move to Redis before running more than one API instance |
| Payment gateway, iOS app, partial delivery | Not in release one | Not confirmed / not enabled |
| Hosting, backups schedule, monitoring | Scripts and runbook ready; schedule and alerts depend on the host | Phase 12 |
| Mobile app E2E | Unit/component tests only | Needs a device farm or emulator in CI |
