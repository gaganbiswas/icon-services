# MVP Scope — Release One

Status: **Draft — awaiting owner approval.** Derived from `CLAUDE.md` §1, §5, §9.

## In scope (release one)

| Area | Included |
|------|----------|
| Platforms | Responsive web (`apps/web`) for staff + customer portal; Android customer app (`apps/mobile`); REST API (`apps/api`) |
| Roles | Super Admin, Branch Admin/Manager, Reception, Technician, Accounts, Delivery Staff, Customer, Auditor — permission-based RBAC, branch scoping |
| Customers & assets | Customer CRUD, consents, device register (Desktop, Laptop, Printer, Monitor, Other — configurable categories), warranty data, intake photos |
| Intake | Job intake wizard, concurrency-safe job numbers, idempotent creation, printable job receipt (PDF) |
| Lifecycle | Explicit status transition matrix, append-only history, customer-facing status mapping, hold/cancel/reopen with reasons |
| Technician | Assignment history, diagnosis, work logs, internal vs customer-visible notes, QC checklist |
| Estimates | Versioned immutable estimates, approve/reject via app/portal or expiring single-use link, approval-before-repair enforcement |
| Inventory | Parts, branch stock, stock-movement ledger, reservation/consumption/return, no negative stock without permission |
| Invoicing | GST and NON_GST modes driven **only by accountant-approved configuration**; immutable snapshots; credit notes; PDFs |
| Payments | Offline payment recording (cash, UPI, bank transfer, card terminal, cheque, other), split/partial payments, allocations, refunds/reversals, receipts |
| Delivery | Pickup / home / on-site, handover checklist, recipient proof, due-balance override, delivery challan PDF |
| Notifications | Outbox + queue, provider adapters; **mocked** until providers chosen (Phase 10), then WhatsApp official API + transactional email |
| Reports | Dashboard widgets and reports listed in `CLAUDE.md` §4.12, CSV/XLSX/PDF export with permission checks |
| Audit | Audit log for financial, tax, permission, warranty, status, delivery and customer-data changes |

## Out of scope (release one) unless owner approves

- iOS app.
- Online payment gateway (recorded as later optional phase).
- Dedicated technician mobile app (technicians use responsive web).
- Installable desktop app — **not required** (owner answer A1). Web only.
- Supplier purchase orders beyond basic optional supplier record.
- Unofficial WhatsApp automation — **never** in scope.
- Microservices.

## Phase gating

Phases 1–12 per `CLAUDE.md` §10. Each phase starts only after owner approval
of the previous phase. Phase 7 (invoicing/tax) additionally requires written
accountant confirmation.

## Release-one acceptance criteria

As listed in `CLAUDE.md` §9 (items 1–12).
