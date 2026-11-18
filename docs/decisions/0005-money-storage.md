# 0005 — Money storage strategy

- **Status:** Proposed
- **Date:** 2026-11-18

## Context

`CLAUDE.md` requires one consistent, decimal-safe approach; never floating point.

## Proposed decision

- Store all monetary amounts as PostgreSQL **`NUMERIC(19,4)`** (Prisma `Decimal @db.Decimal(19,4)`).
- Store tax rates as `NUMERIC(9,6)` (e.g. a percentage with fractional precision).
- Quantities as `NUMERIC(19,4)` (some parts may be sold by length/weight).
- In TypeScript, money is handled only via a decimal library
  (`decimal.js`, which Prisma's `Decimal` already uses) through a single
  `Money` helper in `packages/contracts`. JavaScript `number` is never used for money.
- Amounts are serialized over the API as **strings** (e.g. `"1180.00"`), never JSON numbers.
- Rounding mode and the level at which rounding is applied (line vs. invoice
  vs. tax component) are **not decided** — they depend on the approved tax
  rules (0007) and must be confirmed by the accountant.
- Every amount record carries a currency code (ISO 4217). Default currency is **not assumed**.

## Alternatives considered

- Integer minor units (`BIGINT` paise/cents): simple, but awkward for
  sub-minor-unit tax intermediate values and unit prices with more than 2
  decimals. Rejected in favour of NUMERIC(19,4).
