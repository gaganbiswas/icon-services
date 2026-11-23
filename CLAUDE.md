# ICON INFOSYS SERVICE MANAGEMENT

## Claude Code Project Instructions (`CLAUDE.md`)

> **Purpose:** This file is the source of truth for Claude Code while
> planning, implementing, testing, and maintaining the ICON INFOSYS
> SERVICE MANAGEMENT system. Read it before making changes. Do not skip
> phases or silently make business, tax, security, or data-model
> assumptions.

------------------------------------------------------------------------

## 1. Product decision record

### Confirmed requirements

-   Product name: **ICON INFOSYS SERVICE MANAGEMENT**
-   Platforms:
    -   Android customer application (`apps/mobile`).
    -   Responsive customer web portal for desktop and mobile browsers
        (`apps/web`, Next.js 16). No installable desktop application
        (owner decision, ADR 0003).
    -   Admin, reception, accounts, manager, delivery, auditor and
        technician workspaces in the staff admin panel (`apps/admin`,
        React + TanStack Router SPA, ADR 0008).
-   Business domain: computer hardware service centre.
-   Supported equipment: Desktop, Laptop, Printer, Monitor. Design
    categories so more equipment types can be added without schema
    changes.
-   Service coverage: **In Warranty** and **Out of Warranty**.
-   Customer complaint registration and customer/item details.
-   Printable customer job-receipt copy.
-   Admin/authorized technician-controlled work-progress updates.
-   Final invoice generation after repair completion.
-   Send invoice and service notifications using WhatsApp API
    integration and email.
-   Delivery, payment collection, payment modes, and printable delivery
    challan.
-   Billing mode: **GST tax invoices** (regular scheme, GSTIN
    19AHDPB5074F1ZK, West Bengal), plus a **Bill of Supply** (no GST)
    that accounts staff may choose per invoice with a recorded reason
    (owner decision 2026-11-21, ADR 0024; supersedes "GST only" in ADR 0021).
-   Service workflow must preserve a full audit trail.

### Important assumptions that must remain configurable

1.  Confirmed (ADR 0021, ADR 0024): GST-registered under the regular
    scheme in West Bengal, India (GSTIN 19AHDPB5074F1ZK); currency INR;
    time zone Asia/Kolkata (+05:30); financial year April–March; GST
    18 % added on top of prices; CGST+SGST within West Bengal, IGST
    otherwise; total rounded to the rupee; no e-invoicing, e-way bill or
    reverse charge; invoice numbers `MT/<year>/<n>`; zero-value invoices
    for warranty jobs. Still **not** confirmed: HSN/SAC codes and invoice
    terms/signatory wording.
    Build a configurable tax engine. Do not hard-code tax rates or claim
    legal compliance. Obtain approval from the business's accountant/tax
    professional before production billing.
2.  WhatsApp means an official WhatsApp Business Platform / approved
    provider integration. Do not automate WhatsApp Web, browser
    sessions, or unofficial libraries.
3.  Customer app is Android-first. iOS is not part of the confirmed
    first release.
4.  Online payment gateway is not confirmed. First release supports
    recording offline/externally collected payments (cash, UPI, bank
    transfer, card terminal, cheque, other) and split payments. Gateway
    integration is a later optional phase.
5.  The system is multi-user and should be designed to support multiple
    branches, even if the first deployment has one branch.
6.  Customer-facing status visibility must be limited to safe,
    customer-appropriate status messages. Internal technician notes must
    never be exposed to customers.
7.  Do not assume that every warranty repair is free. Warranty coverage,
    approval, exclusions, and payable amounts must be recorded
    separately.

If any assumption affects a legal invoice, payment, customer data, or
irreversible operation, ask the project owner before implementation.

------------------------------------------------------------------------

## 2. Product goals and user roles

### Primary goals

-   Register each service request exactly once and give it a unique,
    human-readable job number.
-   Maintain a traceable chain from complaint intake through diagnosis,
    estimate approval, repair, quality check, invoice, payment, and
    delivery.
-   Give customers controlled visibility into their job progress.
-   Prevent unauthorized changes to prices, tax, payments, warranty
    decisions, and job status.
-   Produce consistent printable documents and retain immutable
    historical snapshots of issued documents.
-   Make notifications reliable, consent-aware, retryable, and
    auditable.

### Roles and permissions

Implement RBAC with permissions, not just role-name checks. Seed these
roles; allow administrators to configure permissions.

  -----------------------------------------------------------------------
  Role                                Typical permissions
  ----------------------------------- -----------------------------------
  Super Admin                         All branches, settings, users,
                                      audit, configuration

  Branch Admin / Manager              Branch operations, approvals,
                                      reports, staff, jobs

  Reception                           Customers, assets, intake, job
                                      receipts, customer communication

  Technician                          Assigned jobs, diagnosis, internal
                                      notes, parts used, progress

  Accounts                            Estimates where allowed, invoices,
                                      credit notes, payments, reports

  Delivery Staff                      Delivery assignment, handover
                                      checklist, signature/proof

  Customer                            Own profile, own devices/jobs,
                                      estimate decision, status,
                                      documents

  Auditor / Read Only                 Read permitted records and audit
                                      trail
  -----------------------------------------------------------------------

Enforce authorization in the API on every request. UI hiding is not
authorization. Scope branch-owned records by branch. A user must not
access another customer's data by changing an ID in a URL.

------------------------------------------------------------------------

## 3. Recommended technical architecture

Use a TypeScript monorepo. Keep business logic in the backend and shared
validation/types in packages.

### Stack

-   Monorepo: Bun workspaces + Turborepo (Bun is the package manager and
    script runner; never use npm/pnpm/yarn. See ADR 0001).
-   Runtime: Node.js LTS runs the API, worker, Next.js and Expo tooling
    (ADR 0006).
-   Staff admin panel (`apps/admin`): React + TanStack Router SPA built
    with Vite, TypeScript (ADR 0008).
-   Customer web portal (`apps/web`): Next.js 16 (App Router),
    TypeScript, React.
-   Android: React Native with Expo, TypeScript.
-   API: NestJS, TypeScript, REST API with OpenAPI/Swagger.
-   Database: PostgreSQL.
-   ORM and migrations: Prisma.
-   Background jobs: Redis + BullMQ.
-   File storage: S3-compatible object storage; local SeaweedFS for
    development (MinIO images are no longer published; ADR 0009).
-   Authentication: short-lived access tokens + rotating refresh tokens;
    secure password hashing (Argon2id). Consider OTP provider
    integration only after selecting provider.
-   Validation: Zod for shared/client schemas and class-validator or Zod
    consistently at API boundaries. Do not duplicate conflicting
    validation rules.
-   UI: accessible component system with consistent design tokens.
-   Testing: Vitest/Jest as appropriate, Supertest for API, Playwright
    for web end-to-end, Expo testing for mobile.
-   Observability: structured logs, error reporting, health checks,
    metrics, job queue monitoring.
-   Deployment: Docker for local development; production deployment must
    be selected based on the owner's hosting, data residency, backup,
    and budget requirements.

Do not introduce microservices for the first release. Use a modular
monolith with clear domain modules and background workers. This is
simpler to build, test, deploy, and maintain.

### Suggested repository layout

``` text
icon-infosys-service-management/
  CLAUDE.md
  README.md
  package.json         # includes Bun "workspaces"
  bun.lock
  turbo.json
  .env.example
  docker-compose.yml
  apps/
    api/                 # NestJS REST API and worker bootstrap
    admin/               # Vite + React + TanStack Router staff admin panel
    web/                 # Next.js 16 customer web portal
    mobile/              # Expo Android customer app
  packages/
    database/            # Prisma schema, migrations, seed
    contracts/           # shared DTOs, schemas, enums, API types
    ui/                  # shared web UI components where practical
    config/              # lint, TypeScript, formatting configuration
  docs/
    product-requirements.md
    architecture.md
    database-dictionary.md
    api-specification.md
    security-and-privacy.md
    deployment-runbook.md
    decisions/
  infra/
    docker/
    scripts/
```

### Domain modules in the API

`auth`, `users`, `branches`, `customers`, `customer-consents`, `assets`,
`service-jobs`, `job-status`, `diagnosis`, `estimates`,
`estimate-approvals`, `inventory`, `parts`, `technician-assignment`,
`invoices`, `tax`, `payments`, `refunds`, `delivery`, `documents`,
`notifications`, `whatsapp`, `email`, `reports`, `audit`, `settings`.

Each module owns its services, DTOs, authorization checks, tests, and
documented API routes. Avoid circular dependencies.

------------------------------------------------------------------------

## 4. Functional requirements and workflows

### 4.1 Customer and asset records

Customer fields: - Internal UUID. - Customer code (unique, generated). -
Customer type: individual/business. - Full name or legal business
name. - Primary mobile number (normalized E.164 where possible),
alternate phone. - Email. - Billing address and service address, each
with country, address lines, city, region/state, postal code. - Optional
tax identity/GSTIN only if relevant to confirmed jurisdiction and
customer type. - Preferred language and communication preferences. -
Consent records with purpose, channel, timestamp, source, policy
version, and withdrawal timestamp. - Created/updated timestamps and
soft-delete/anonymization state.

Asset/device fields: - Customer owner. - Category: Desktop, Laptop,
Printer, Monitor, Other (configurable). - Brand, model, serial number,
asset tag. - Purchase date, warranty start/end, warranty provider,
warranty reference, proof-of-purchase file. - Accessories received. -
Physical condition and intake photos. - Device-specific attributes
stored in structured fields or a validated JSON extension, not an
ever-growing set of nullable columns. - Do not assume serial number is
globally unique; use a duplicate warning and configurable uniqueness
policy.

### 4.2 Job intake

A job/service request must capture: - Unique job number generated
server-side, branch-aware and concurrency-safe. - Customer and asset
references; allow a new customer/device to be created during intake. -
Service type: `IN_WARRANTY` / `OUT_OF_WARRANTY` / `WARRANTY_UNVERIFIED`
(internal provisional state if needed). - Service mode:
`AT_SERVICE_CENTRE` / `ON_SITE`. - Complaint description in customer's
words. - Intake checklist, accessories, visible condition,
photos/files. - Received date/time, received by, branch, expected
completion date (optional). - Warranty proof and verification outcome,
verifier, timestamp, notes. - Initial status and customer-facing
status. - Customer signature/acknowledgment where supported. - Printed
receipt and PDF copy. - Idempotency key to prevent duplicate job
creation on retries.

Do not allow a job to be finalized without the required customer, asset,
complaint, branch, and intake fields. Make required fields configurable
only where doing so does not undermine traceability.

### 4.3 Job status lifecycle

Use explicit state transitions, not arbitrary status text. Initial
internal statuses: `RECEIVED`, `WARRANTY_CHECK`, `DIAGNOSIS`,
`ESTIMATE_PREPARATION`, `AWAITING_CUSTOMER_APPROVAL`,
`WAITING_FOR_PARTS`, `REPAIR_IN_PROGRESS`, `QUALITY_CHECK`,
`REPAIR_COMPLETED`, `READY_FOR_DELIVERY`, `OUT_FOR_DELIVERY`,
`DELIVERED`, `CANCELLED`, `ON_HOLD`.

Rules: - All transitions happen through a domain service with permission
checks. - Store `from_status`, `to_status`, actor, timestamp, reason,
customer-visible message, and metadata in an append-only status
history. - Require reasons for hold, cancellation, reopening, and
exceptional transitions. - Customer-facing statuses are a separate
mapped set; never expose internal notes or sensitive details. - Record
who changed a status and from which channel. - Define valid transition
matrix in tests and docs. - A delivered job cannot be edited as if still
active. Corrections must use controlled adjustment/reversal workflows. -
Reopening a completed/delivered job requires elevated permission and
audit reason.

### 4.4 Diagnosis, estimates, and customer approval

-   Diagnosis records symptom, root cause, recommended work, technician,
    timestamp, and internal notes.
-   Estimate lines: labor, parts, service fees, discounts, tax
    treatment, quantity, unit, price, and totals.
-   Estimate versions are immutable once sent. Revisions create a new
    version.
-   Customer can approve/reject the estimate using authenticated
    app/portal flow or a secure, expiring, single-use approval link.
-   Store decision, actor, timestamp, IP/device metadata where lawful,
    estimate version, and terms accepted.
-   No repair work requiring customer approval may proceed before
    approval, except a separately configured diagnostic fee or emergency
    policy explicitly approved by the business.
-   Clearly distinguish warranty-covered, goodwill, and customer-pay
    line items.

### 4.5 Technician work

-   Assign one or more technicians; record assignment and reassignment
    history.
-   Technician can add diagnosis, internal notes, customer-safe progress
    message, parts request, parts consumed, labor entries, photos, and
    completion checklist.
-   Internal notes are staff-only.
-   Track timestamps and time spent if enabled.
-   Require repair summary and quality-control checklist before marking
    repair complete.
-   Track replaced parts and returned defective parts where applicable.

### 4.6 Inventory and parts

First release should support basic inventory: - Part SKU/code, name,
description, category, unit, compatible brands/models (optional),
reorder level, active flag. - Branch stock, stock movements, supplier
(optional), purchase cost, selling price, tax category. - Stock
movements: purchase/receive, reservation, consume, return, adjustment,
transfer. - Every movement has quantity, reason, user, job/reference,
and timestamp. - Prevent negative stock by default; only allow override
with explicit permission and audit. - Job parts usage must create
corresponding stock movement in the same transaction. - Do not silently
change historical invoice prices when catalogue prices change.

### 4.7 Invoice and tax

Invoices are **GST tax invoices** by default, with tax calculated
according to the configured and legally approved jurisdiction settings.
Accounts staff may instead issue a **Bill of Supply** (no GST, own number
series) for a specific invoice, giving a reason that is stored and audited
(owner decision, ADR 0024). The invoice model's `document_type` field holds
the choice; a database check guarantees a Bill of Supply carries no tax.
Rule (owner, 2026-11-23): a Bill of Supply is used whenever staff select
it for an invoice. Do not add automatic rules or restrictions on when it
applies; keep the required reason and audit record.

Invoice requirements: - Unique invoice number by branch/series/financial
year, generated safely under concurrent requests. - Link to job,
customer, branch, and immutable bill-to snapshot. - Invoice date, due
date, currency, tax mode, line items, discounts, tax breakdown,
rounding, subtotal, total, amount paid, balance due. - Separate
line-level tax category and tax rate snapshot; rates must be
configurable and effective-dated. - Support tax-inclusive and
tax-exclusive pricing if required by confirmed jurisdiction. - Support
line-level and invoice-level discounts with clear allocation rules. -
Credit notes, cancellation/void process, and refunds must be controlled,
permissioned, and audited. - Never delete an issued invoice. Correct it
using a credit note/replacement invoice process appropriate to the
confirmed jurisdiction. - Store a rendered PDF/document snapshot or
reproducible immutable invoice data. Reprinting must not change
historical values. - Invoice calculation uses decimal arithmetic (never
JavaScript floating-point arithmetic for money). Store amounts in
integer minor units or PostgreSQL `NUMERIC` with explicit
precision/scale. Define one approach consistently. - Round only
according to the approved tax rules; test edge cases. - Keep tax
configuration, HSN/SAC, GSTIN, place of supply,
reverse-charge/e-invoice/e-way bill fields configurable and disabled
until confirmed as applicable. - GST compliance and invoice wording must
be reviewed by a qualified local tax professional before production use.

### 4.8 Payments

-   Support multiple payments against one invoice and partial payments.
-   Methods configurable: cash, UPI, bank transfer, card terminal,
    cheque, payment gateway, other.
-   Record amount, currency, date/time, method, transaction/reference
    number, received by, branch, notes, and receipt number.
-   Payment status derived from allocations: unpaid, partially paid,
    paid, overpaid/refund due.
-   Do not store card numbers, CVV, banking passwords, or UPI PINs.
-   Refunds and payment reversals require permission, reason, reference,
    and audit record.
-   Payment receipt must be printable/downloadable.
-   Do not mark a job delivered automatically merely because an invoice
    is paid; delivery is a separate workflow.

### 4.9 Delivery and delivery challan

-   Delivery mode: customer pickup, home delivery, on-site return,
    other.
-   Delivery record: recipient name, relationship/authorization, address
    if applicable, dispatched/handed-over date/time, staff member,
    handover checklist, accessories returned, condition, customer
    signature/proof, notes.
-   Delivery challan has unique number, branch details, customer
    snapshot, job number, asset details, serial number, delivery date,
    payment status, and signature fields.
-   Challan is a delivery/hand-over document, not an invoice and not
    proof of payment unless a separate receipt says so.
-   Support partial delivery only if the business explicitly enables it.
-   A job can be marked `DELIVERED` only after mandatory handover fields
    are satisfied.
-   Outstanding balance policy must be configurable: allow delivery with
    due balance only for authorized roles and record approval.

### 4.10 Notifications: WhatsApp and email

Use a provider adapter so provider changes do not affect job logic. -
WhatsApp integration must use the official WhatsApp Business Platform or
a vetted authorized provider. - Store provider credentials only in
server-side secrets manager/environment, never in mobile/web bundles or
database plaintext. - Use approved templates for business-initiated
messages when required by WhatsApp policy. Track template name,
language, parameters, consent, provider message ID,
delivery/read/failure status. - Respect opt-in, opt-out, quiet hours if
configured, and applicable messaging laws. - Email via a transactional
email provider; verify sender domain and configure SPF, DKIM, and
DMARC. - Events: job received, status changed, estimate ready, estimate
approved/rejected, repair completed, invoice issued, payment receipt,
ready for delivery, delivery confirmation. - Notification sending is
asynchronous through an outbox/queue. Persist notification intent before
enqueueing; retries must be idempotent. - Do not block job/invoice
transactions waiting for a WhatsApp/email provider. - Log delivery
attempts and errors without logging sensitive message content or
credentials. - If WhatsApp fails, show retry state and allow authorized
manual retry. Do not claim a message was delivered merely because an API
request was accepted.

### 4.11 Documents and printing

Generate PDF documents server-side with stable templates: 1. Customer
job receipt / job sheet. 2. Estimate / quotation. 3. Final GST invoice.
4. Payment receipt. 5. Delivery challan. 6. Optional warranty/service
report.

Requirements: - A4 and configurable thermal receipt layouts where
appropriate. - Business logo, address, contact, document number, date,
customer, device, line items, totals, terms, and signature areas. -
Print preview and download. - Store document type, version, storage key,
generated timestamp, and linked record. - Never expose private file
storage URLs permanently. Use short-lived signed URLs and authorization
checks. - Test page breaks, long customer names, multiple line items,
Unicode, and printer-friendly grayscale output.

### 4.12 Reports and dashboard

Dashboard widgets: - New jobs today. - Jobs by current status. - Overdue
jobs. - Jobs awaiting customer approval. - Waiting-for-parts jobs. -
Completed/ready-for-delivery jobs. - Payments collected today/month. -
Outstanding balances. - Technician workload. - Warranty vs
out-of-warranty volume.

Reports: - Job register with date/status/branch/technician/category
filters. - Customer service history. - Technician performance and
turnaround time. - Parts usage and stock valuation. - Invoice and tax
summaries (subject to confirmed jurisdiction). - Payment collection by
method and cashier. - Outstanding invoices and aging. - Delivery
register. - Export CSV/XLSX/PDF with permission checks and audit logs.

------------------------------------------------------------------------

## 5. Screen inventory

### Android customer app

1.  Splash, onboarding, language selection.
2.  Sign in / OTP verification (after provider selection).
3.  Customer profile and communication consent.
4.  Home: active jobs, recent history, create complaint.
5.  Create complaint: choose product category, choose existing/new
    device, warranty status, service mode, complaint, photos,
    accessories, address.
6.  Review and submit complaint.
7.  Job confirmation and receipt download/share.
8.  My service requests list.
9.  Job detail: customer-safe timeline, appointment/branch information,
    estimate and approval action, invoice/payment documents.
10. Estimate detail: line items, terms, approve/reject.
11. Notifications.
12. My devices and service history.
13. Help/contact, privacy policy, terms, account/data request.

### Web staff application

1.  Login, forgot password, MFA setup for privileged users.
2.  Dashboard.
3.  Job list with filters, search, saved views, export.
4.  New job intake wizard.
5.  Job detail workspace with tabs:
    -   Overview
    -   Customer/device
    -   Timeline
    -   Diagnosis
    -   Estimate/approval
    -   Technician/work log
    -   Parts
    -   Invoice
    -   Payments
    -   Delivery
    -   Documents
    -   Audit history
6.  Customer list and customer profile/history.
7.  Asset/device register.
8.  Technician board and assignments.
9.  Inventory: parts, stock, movements, suppliers (if enabled).
10. Estimates and approval queue.
11. Invoice register and invoice detail.
12. Payment collection and receipts.
13. Delivery register and challan.
14. Notification centre and failed-message retry.
15. Reports and exports.
16. User/role/permission management.
17. Branch and business profile settings.
18. Tax, invoice numbering, document templates, notification templates.
19. Audit log.
20. System health/integration settings (admin only).

### Technician experience

Use a responsive web/PWA workspace in release one unless a dedicated
technician mobile app is separately approved: - My assigned jobs. - Job
detail and safe customer contact data. - Diagnosis form. - Work log and
status update. - Parts request/use. - Photo upload. - Quality checklist
and completion submission.

### Common UX requirements

-   Responsive, keyboard accessible, readable contrast, clear form
    errors.
-   Search by job number, customer name/mobile, serial number, invoice
    number.
-   Confirmation dialogs for destructive/irreversible actions.
-   Autosave drafts where safe; explicit save for financial/status
    changes.
-   Use local timezone for display but store timestamps in UTC.
-   Show loading, empty, error, and retry states.
-   Do not rely on color alone to communicate status.
-   Make customer-visible wording understandable and avoid exposing
    internal workflow terms.

------------------------------------------------------------------------

## 6. Database design blueprint

Use UUID primary keys, UTC timestamps (`created_at`, `updated_at`),
foreign keys, appropriate indexes, and database constraints. Prefer soft
deletion only for records where legally/business appropriate; financial
records and audit history must not be hard-deleted. Use append-only
event/history tables for state changes.

### Core tables

-   `organizations`: legal/business entity, display name, default
    currency, timezone, country, active state.
-   `branches`: organization, branch code, name, address, contact,
    timezone, active state.
-   `users`: identity, login identifier, password hash or external auth
    subject, active/locked state, last login.
-   `roles`, `permissions`, `user_roles`, `role_permissions`,
    `user_branch_access`.
-   `customers`: organization, customer code, type, names, phone/email,
    addresses, preferred language, status.
-   `customer_consents`: customer, channel, purpose, consent state,
    policy version, source, granted/withdrawn timestamps.
-   `assets`: customer, category, brand, model, serial,
    purchase/warranty data, attributes JSONB, active state.
-   `files`: storage key, original name, MIME type, size, checksum,
    uploader, privacy classification.
-   `service_jobs`: organization, branch, job number, customer, asset,
    service type, service mode, complaint, intake data, current internal
    status, customer status, dates, received-by, assigned owner,
    version.
-   `job_status_history`: job, from/to status, actor, reason, customer
    message, channel, timestamp.
-   `job_assignments`: job, technician, assigned-by, start/end,
    assignment notes.
-   `diagnoses`: job, technician, symptom, findings, root cause,
    recommendation, internal notes, created time.
-   `work_logs`: job, technician, work description, duration,
    visibility, created time.
-   `job_attachments`: job, file, category, visibility.
-   `estimates`: job, version, status, currency, totals, validity,
    terms, sent/decision timestamps.
-   `estimate_lines`: estimate, line type, description, SKU snapshot,
    quantity, unit price, discount, tax category/rate snapshot, totals.
-   `estimate_decisions`: estimate/version, decision, customer/user,
    timestamp, method, evidence metadata.
-   `parts`: organization, SKU, name, description, category, unit, tax
    category, active state.
-   `branch_stock`: branch, part, on-hand, reserved, reorder level;
    unique branch+part.
-   `stock_movements`: branch, part, movement type, quantity, unit cost
    snapshot, job/reference, actor, reason, timestamp.
-   `suppliers` (optional in MVP): organization, name, contact, address.
-   `invoices`: organization, branch, job, invoice number, series,
    financial year, invoice mode, immutable customer/business/tax
    snapshots, currency, dates, totals, status, issued timestamp.
-   `invoice_lines`: invoice, source estimate line (optional),
    description/SKU snapshot, quantity, unit price, discount, tax
    category/rate/amount snapshot, totals.
-   `invoice_tax_summaries`: invoice, tax component/code/rate/taxable
    amount/tax amount.
-   `credit_notes`: invoice, credit note number, reason, amounts, issue
    date, status.
-   `payments`: organization, branch, receipt number, method, amount,
    currency, transaction reference, received-by, date, status.
-   `payment_allocations`: payment, invoice, allocated amount; prevent
    allocation exceeding available payment/invoice balance unless
    approved credit handling exists.
-   `refunds`: payment/invoice, amount, method, reference, reason,
    approved-by, timestamp.
-   `deliveries`: job, challan number, mode, recipient, address
    snapshot, handover data, payment-due override, delivered-by,
    timestamp.
-   `delivery_items`: delivery, asset/accessory, condition, returned
    flag, notes.
-   `documents`: organization, branch, linked entity/type/id, document
    number, version, file, generated time, immutable metadata.
-   `notification_outbox`: event type, aggregate type/id, payload
    reference, status, attempts, next attempt, idempotency key.
-   `notification_deliveries`: channel, provider, provider message ID,
    template, status, sent/delivered/read times, error code, retry
    count.
-   `notification_preferences`: customer, channel, purpose, enabled
    state.
-   `audit_logs`: actor, action, entity type/id, before/after redacted
    JSON, reason, request ID, IP/device metadata where lawful,
    timestamp.
-   `number_sequences`: organization, branch, document type, financial
    year, current value; lock/update transactionally.
-   `business_settings`: scoped key/value configuration with schema
    validation and versioning.
-   `tax_rates` / `tax_categories`: jurisdiction, code, rate, effective
    dates, tax behavior, active state. Only approved configurations may
    be activated.
-   `idempotency_keys`: actor/client key, route/operation, request hash,
    response reference, expiry.

### Key database rules

-   Use unique constraints for
    `(organization_id, branch_id, job_number)` and
    invoice/challan/receipt number scope.
-   Number generation must be transactional and concurrency-safe; never
    generate numbers by `MAX(number)+1`.
-   Add indexes for job number, customer phone, customer name, serial
    number, job status/date, technician assignment, invoice number/date,
    payment date, and foreign keys.
-   Use transactions for: job intake + number assignment; estimate
    versioning; invoice issue; payment allocation; stock consumption;
    delivery completion; outbox event creation.
-   Store money as PostgreSQL `NUMERIC(19,4)` or integer minor units
    consistently. Never use floating point for money. Document the
    selected strategy.
-   Store phone numbers normalized but preserve a display value.
-   Use JSONB only for genuinely variable attributes, not for core
    relational data.
-   Restrict database access to the API/service layer; do not connect
    clients directly to PostgreSQL.
-   Enforce organization/branch scoping in repository/service queries
    and test for cross-tenant leakage.

------------------------------------------------------------------------

## 7. API design conventions

Base path: `/api/v1`. Use REST, JSON, OpenAPI documentation, consistent
error shape, pagination, filtering, and sorting.

Example endpoint groups:

``` text
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
GET    /me

GET    /customers
POST   /customers
GET    /customers/:id
PATCH  /customers/:id
GET    /customers/:id/jobs

GET    /assets
POST   /assets
GET    /assets/:id

GET    /jobs
POST   /jobs
GET    /jobs/:id
PATCH  /jobs/:id
POST   /jobs/:id/status-transitions
POST   /jobs/:id/assignments
POST   /jobs/:id/diagnoses
POST   /jobs/:id/work-logs
POST   /jobs/:id/attachments

POST   /jobs/:id/estimates
POST   /estimates/:id/send
POST   /estimates/:id/decision

POST   /jobs/:id/invoices
GET    /invoices/:id
POST   /invoices/:id/issue
POST   /invoices/:id/credit-notes

POST   /invoices/:id/payments
GET    /payments/:id/receipt

POST   /jobs/:id/deliveries
GET    /deliveries/:id/challan

GET    /notifications
POST   /notifications/:id/retry

GET    /reports/jobs
GET    /reports/revenue
GET    /reports/outstanding
```

The exact routes may evolve, but keep API naming consistent and
versioned. Customer endpoints must derive customer identity from the
authenticated principal; never trust a client-supplied customer ID as
proof of ownership.

### API requirements

-   DTO/schema validation at every write boundary.
-   Authentication and permission guard on protected routes.
-   Rate limits on login, OTP, public tracking, and approval links.
-   Idempotency for job creation, invoice issue, payment callbacks, and
    delivery completion.
-   Optimistic concurrency/version checks for concurrent edits.
-   Standard error codes; do not return stack traces or secrets.
-   Pagination defaults and maximum page size.
-   Audit sensitive mutations.
-   OpenAPI docs generated from actual DTOs/controllers.
-   API contract tests for permissions and state transitions.

------------------------------------------------------------------------

## 8. Security, privacy, and reliability

-   TLS everywhere; HSTS for web.
-   Secure, HttpOnly, SameSite cookies for browser refresh sessions
    where applicable; protect against CSRF. Mobile token storage must
    use OS secure storage.
-   Argon2id password hashing; MFA for privileged roles where feasible.
-   Rotate refresh tokens; detect reuse and revoke token family.
-   Least-privilege RBAC and branch scope.
-   Validate uploads by MIME sniffing, size limits, malware scanning
    where available, and randomized storage keys. Do not serve uploaded
    files as executable content.
-   Encrypt backups and sensitive secrets; use a secrets manager in
    production.
-   Never commit `.env`, provider tokens, private keys, or customer
    data.
-   Redact PII from logs and analytics.
-   Audit financial, tax, permission, warranty, status, delivery, and
    customer-data changes.
-   Define retention, deletion, export, and data-subject request
    procedures after confirming applicable law.
-   Backups: automated encrypted daily backups, point-in-time recovery
    where supported, and documented restore drills.
-   Queue jobs must have bounded retries, exponential backoff,
    dead-letter handling, and operator visibility.
-   Health endpoints: liveness, readiness, database, Redis, object
    storage, provider integration status.
-   Establish RPO/RTO with the owner before production.
-   Do not claim the system is secure or compliant solely because these
    controls are listed; test and review it.

------------------------------------------------------------------------

## 9. Testing and acceptance criteria

### Required automated tests

-   Unit tests for money/tax calculations, invoice totals, rounding,
    discounts, warranty classification, status transition matrix,
    permission rules, numbering, and payment allocation.
-   Integration tests for DB transactions, outbox, stock movement,
    invoice issuance, payment allocation, and delivery.
-   API tests for role/branch/customer authorization and IDOR
    prevention.
-   Web E2E for intake → diagnosis → estimate → approval → repair →
    invoice → payment → delivery.
-   Mobile E2E for customer registration/login (when provider
    configured), complaint submission, status tracking, estimate
    decision, and document access.
-   Notification tests using mocked provider adapters; test retries and
    duplicate event delivery.
-   PDF tests for required fields and layout cases.
-   Migration tests from an empty database and from the previous release
    schema.
-   Security checks: dependency audit, secret scan, upload validation,
    rate limiting, authorization matrix.

### Release-one acceptance criteria

1.  Reception can register a customer, device, and complaint without
    duplicate jobs on retry.
2.  A unique job receipt is generated and printable.
3.  A permitted admin/technician can assign and progress a job; every
    change appears in history.
4.  A customer can only see their own jobs and customer-visible
    messages.
5.  Technician notes remain private.
6.  Estimate versioning and explicit customer approval/rejection work.
7.  Authorized accounts staff can issue GST invoices using approved
    configuration; issued invoice values remain immutable.
8.  Multiple partial payments can be recorded and allocated; balance is
    correct.
9.  Delivery challan prints and delivery requires a handover record.
10. WhatsApp/email events are queued, provider responses are tracked,
    retries are safe, and opt-out is respected.
11. Reports match underlying records and are permission-filtered.
12. Automated tests pass; migrations and backup/restore procedure are
    documented.

------------------------------------------------------------------------

## 10. Step-by-step build plan for Claude Code

**Claude must work one phase at a time.** At the start of each phase:
inspect the repository, read this file, summarize the intended changes,
identify unresolved assumptions, and propose a small task checklist.
Implement only the approved phase. At the end: run tests/lint/typecheck,
report files changed, report commands and results, list remaining risks,
and wait for approval before the next phase.

### Phase 0 --- Discovery and decision log

-   Inspect repository and existing code before changing anything.
-   Confirm business country/state, currency, legal name, address, tax
    registration, tax rules, invoice numbering, time zone, branches,
    languages, hosting, OTP provider, WhatsApp provider, email provider,
    logo/brand assets, and retention requirements.
-   Create `docs/decisions/` records for approved decisions.
-   Create product requirements, architecture, threat model, and MVP
    scope.
-   Do not implement tax rules until jurisdiction is confirmed.

**Exit:** owner-approved decision log and MVP scope.

### Phase 1 --- Monorepo foundation

-   Create Bun workspaces + Turborepo workspace.
-   Add admin, web, API, mobile, contracts, database packages.
-   Add strict TypeScript, lint, format, test, env validation.
-   Add Docker Compose for PostgreSQL, Redis, SeaweedFS (S3).
-   Add CI pipeline and health-check skeleton.
-   Add `.env.example` with placeholders only.

**Exit:** clean install, lint, typecheck, tests, and local services
work.

### Phase 2 --- Database and authentication

-   Implement Prisma schema and first migration.
-   Seed organization, branch, roles, permissions, and a
    development-only admin.
-   Implement login/session lifecycle, password reset approach, MFA
    plan, RBAC, branch scoping.
-   Add audit foundation and security tests.

**Exit:** authentication and authorization tests pass; no production
default credentials.

### Phase 3 --- Customers, assets, and intake

-   Implement customer CRUD, consent capture, asset CRUD, file upload.
-   Implement job intake, safe job number generation, idempotency, job
    receipt PDF.
-   Build staff screens for customer, asset, and new job.
-   Build Android customer complaint flow and own-job listing.

**Exit:** customer complaint can be registered from staff web and
customer Android app; receipt prints.

### Phase 4 --- Job lifecycle and technician workspace

-   Implement status transition service and append-only history.
-   Implement assignments, diagnosis, work logs, attachments,
    internal/customer-visible notes.
-   Build job detail and technician views.
-   Add notification event creation (provider mocked).

**Exit:** workflow transitions and role visibility tests pass.

### Phase 5 --- Estimates and customer approval

-   Implement versioned estimates and line items.
-   Build estimate UI and secure approval/rejection flow.
-   Notify customer via mocked adapter.
-   Enforce approval-before-repair policy.

**Exit:** estimate lifecycle and approval audit tests pass.

### Phase 6 --- Inventory and parts

-   Implement parts, branch stock, stock movement ledger,
    reservation/consumption/return.
-   Connect parts usage to jobs transactionally.
-   Build inventory screens and low-stock report.

**Exit:** inventory ledger reconciles and cannot silently go negative.

### Phase 7 --- Tax configuration and invoicing

-   First obtain written confirmation of jurisdiction and tax
    configuration from owner/accountant.
-   Implement GST invoicing (tax invoice + staff-chosen Bill of Supply, ADR 0024), effective-dated tax rules,
    decimal-safe calculation, invoice numbering, immutable snapshots,
    PDF templates, credit notes/void workflow.
-   Add tax calculation test vectors approved by the accountant.
-   Do not invent tax rates, legal phrases, HSN/SAC codes, or invoice
    fields.

**Exit:** accountant-approved test cases pass; GST invoice PDFs
verified.

### Phase 8 --- Payments and receipts

-   Implement partial/split payments, allocations, payment receipt,
    refunds/reversals.
-   Add cashier/account permissions and collection reports.
-   Payment gateway only if separately approved.

**Exit:** balances reconcile under partial payment, overpayment, refund,
and reversal scenarios.

### Phase 9 --- Delivery and challan

-   Implement pickup/home/on-site delivery, recipient proof, accessory
    checklist, due-balance override approval, challan numbering/PDF.
-   Build delivery screens and customer delivery notification.

**Exit:** delivered state cannot be reached without required handover
data; challan prints correctly.

### Phase 10 --- Real WhatsApp and email

-   Select official WhatsApp Business provider and transactional email
    provider.
-   Configure credentials through secrets manager.
-   Register/approve templates and sender identity.
-   Implement webhook verification, delivery receipts, opt-out, retries,
    idempotency, failed-message console.
-   Test provider sandbox before live sending.

**Exit:** verified end-to-end messages, consent checks, webhook
signatures, and retry tests pass.

### Phase 11 --- Reports, hardening, and UAT

-   Complete dashboards and reports.
-   Conduct accessibility, performance, security, privacy, and
    backup/restore testing.
-   Run full role-based UAT with realistic sample data.
-   Fix defects; document known limitations.
-   Train reception, technicians, accounts, and admins.

**Exit:** signed UAT checklist and release approval.

### Phase 12 --- Production deployment and operations

-   Confirm hosting, region/data residency, domain, TLS, email DNS,
    secrets, backups, monitoring, RPO/RTO.
-   Run production migrations with rollback/backup plan.
-   Create first admin securely.
-   Configure business details, branches, tax, numbering, templates, and
    providers.
-   Perform smoke tests and verify restore procedure.
-   Provide operations runbook and support handover.

**Exit:** production checklist signed by owner; no demo credentials or
test customer data remain.

------------------------------------------------------------------------

## 11. Claude Code operating rules

Claude Code must: 1. Read `CLAUDE.md` before work and follow it as
project policy. 2. Inspect existing files before creating, replacing, or
deleting anything. 3. Never overwrite working code or user data without
explaining impact and receiving approval. 4. Never guess legal/tax
settings, WhatsApp provider, payment provider, OTP provider, hosting
region, or production secrets. 5. Never hard-code secrets, tax rates,
branch IDs, admin credentials, or production URLs. 6. Use migrations for
schema changes; do not edit production databases manually. 7. Add tests
with each feature. Do not defer all testing to the end. 8. Use
transactions for multi-record financial, stock, numbering, and workflow
operations. 9. Use decimal-safe arithmetic for all money and tax
calculations. 10. Enforce authorization server-side and test
cross-customer/cross-branch access. 11. Keep customer-visible text
separate from internal notes. 12. Make integrations replaceable through
adapters and mock them in automated tests. 13. Never use unofficial
WhatsApp automation or scrape WhatsApp Web. 14. Never log passwords,
tokens, OTPs, full payment credentials, or unnecessary personal data.
15. Do not mark a provider notification as delivered until a delivery
callback/status confirms it. 16. Do not mark a job delivered just
because an invoice is paid. 17. Do not delete issued invoices, payments,
audit records, or status history. Use controlled reversals/credit notes.
18. Keep code typed, modular, documented, and formatted. Avoid `any`; if
unavoidable, explain and constrain it. 19. Run relevant tests, lint, and
typecheck after changes; report actual results, never claim tests passed
if not run. 20. Stop and ask when a requirement conflicts with this file
or a decision is missing.

### Standard response format after each Claude Code task

-   **Phase/task completed**
-   **Design decisions**
-   **Files created/changed**
-   **Database/API changes**
-   **Tests and exact results**
-   **Security/privacy considerations**
-   **Outstanding questions/risks**
-   **Next proposed task** (do not start it without approval)

------------------------------------------------------------------------

## 12. Initial prompt to start Claude Code

After placing this file at the repository root as `CLAUDE.md`, start
Claude Code in the repository and use:

> Read the entire `CLAUDE.md`. Do not write application code yet.
> Perform Phase 0 only: inspect the repository, identify existing
> assets/code, prepare the decision log and MVP scope, and list the
> exact questions the owner must answer before
> implementation---especially legal business jurisdiction/tax setup,
> currency, branch structure, WhatsApp Business provider, email
> provider, authentication/OTP provider, hosting/data residency, and
> document branding. Do not guess answers. Present your findings and
> wait for approval.

------------------------------------------------------------------------

## 13. Production go-live blockers

The following must be resolved before a live launch: - Legal entity
name, registered/business address, country/state, currency, timezone. -
Applicable tax jurisdiction, GST registration status, approved tax rates
and invoice wording, financial year and invoice series. - WhatsApp
Business account/provider, approved templates, opt-in language and
webhook setup. - Email sender/domain and DNS authentication. -
Authentication/OTP provider and account recovery process. - Hosting
provider, deployment region, data residency, backup and restore plan. -
Privacy policy, terms, consent wording, data retention and customer data
request process. - Business logo, contact details, invoice/challan
terms, authorized signatory. - Staff roles, branches, service policies,
warranty rules, estimate approval rules, delivery-with-dues policy. -
UAT sign-off and tax/accounting review.

**Build principle:** deliver a reliable, auditable service-management
workflow first. Add complexity only when a confirmed business
requirement needs it. Never trade correctness, customer privacy,
financial integrity, or traceability for implementation speed.
