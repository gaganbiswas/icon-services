# 0019 — Reports, dashboard and exports

- **Status:** Approved with defaults (owner to confirm items marked DEFAULT)
- **Date:** 2026-11-19

## Decisions

1. **Read-only reports module** in the API (`/reports/*`). Every query is scoped to the caller's organization and
   permitted branches in SQL; an out-of-scope `branchId` returns 404. Reports never mutate data.
2. **Permissions:** `reports.read` plus the domain read permission of the data shown (`jobs.read`, `inventory.read`,
   `payments.read`, `deliveries.read`). Exports additionally need `reports.export` and are **audited**
   (`report.exported` with report, format, filters and row count — no row data in the audit log).
3. **Formats:** CSV (RFC 4180, UTF-8 BOM), XLSX (`write-excel-file`), PDF (existing sandboxed Chromium renderer,
   A4 landscape, grayscale-friendly). Text cells beginning with `= + - @` tab or CR are prefixed with `'` to prevent
   spreadsheet formula injection. Exports are limited to **10,000 rows** (`EXPORT_TOO_LARGE`); periods to 366 days.
4. **Money in XLSX** is written as spreadsheet numbers for analysis (display only). The system's decimal values
   (NUMERIC(19,4), ADR 0005) remain the source of truth; CSV/PDF keep exact decimal text.
5. **Outstanding balances — DEFAULT (interim):** until invoicing (Phase 7), "due" = current APPROVED estimate's
   customer-payable amount − net payments (amount − refunds, reversed excluded) for jobs whose repair is finished
   (REPAIR_COMPLETED, READY_FOR_DELIVERY, OUT_FOR_DELIVERY, DELIVERED). Same basis as the delivery balance (ADR 0017).
   Aging counts from repair completion in buckets 0–30, 31–60, 61–90, 90+ days. Replaced by invoice-based aging in Phase 7.
6. **Stock valuation — DEFAULT (indicative):** on hand × latest purchase (RECEIVE) unit cost per branch. Clearly
   labelled indicative; the accounting valuation method (FIFO / weighted average) must be confirmed by the accountant.
7. **Turnaround:** hours from receipt (or creation) to repair completion, for jobs completed in the period, credited to
   the user who completed the repair; average and median.
8. **Day boundaries** ("today", "this month", overdue) use the organization time zone (UTC until configured, owner
   question on time zone).
9. Invoice and tax summaries are deferred to Phase 7.
