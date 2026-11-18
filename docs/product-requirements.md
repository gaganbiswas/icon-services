# Product Requirements — ICON INFOSYS SERVICE MANAGEMENT

Status: **Draft (Phase 0).** The authoritative detailed requirements are in
`/CLAUDE.md` §1–§5. This document summarises them, records owner changes, and
tracks what is still unconfirmed. It does not add new requirements.

## 1. Purpose

Manage the end-to-end service lifecycle of a computer hardware service centre:
complaint intake → warranty check → diagnosis → estimate & customer approval →
repair & QC → invoice (GST / non-GST) → payment → delivery & challan, with full
audit trail and customer notifications (WhatsApp + email).

## 2. Users

See `CLAUDE.md` §2. Eight seeded roles; permissions configurable by administrators.

## 3. Platforms (owner-confirmed)

| App | Folder | Users | Notes |
|-----|--------|-------|-------|
| Web application | `apps/web` | All staff roles; customers via portal | Responsive, desktop + mobile browsers |
| Android app | `apps/mobile` | Customers | Expo/React Native; Android first |
| API + worker | `apps/api` | — | NestJS; only component that touches PostgreSQL |

## 4. Functional requirements

Reference `CLAUDE.md` §4.1–§4.12 (customer/asset, intake, status lifecycle,
diagnosis/estimates, technician work, inventory, invoice/tax, payments, delivery,
notifications, documents, reports). Screen inventory: `CLAUDE.md` §5.

## 5. Owner changes recorded 2026-11-18

1. Bun replaces pnpm/npm as package manager (ADR 0001).
2. PostgreSQL confirmed (ADR 0002).
3. Web and mobile applications in separate folders (ADR 0003).

## 6. Unconfirmed — see `owner-questions.md`

Jurisdiction, currency, tax setup, numbering formats, providers, hosting,
languages, branding and policies. None of these will be guessed.

## 7. Non-functional requirements

- Security & privacy: `CLAUDE.md` §8; `docs/threat-model.md`.
- Correctness: decimal-safe money (ADR 0005), transactional numbering, idempotency.
- Accessibility: keyboard accessible, readable contrast, status not by colour alone.
- Timestamps stored UTC, displayed in configured local timezone.
- Availability/RPO/RTO: to be set by owner (question G52).
