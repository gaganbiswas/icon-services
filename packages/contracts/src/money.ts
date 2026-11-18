import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Money and quantities are decimal strings with up to 4 fractional digits,
 * matching NUMERIC(19,4) (ADR 0005). JavaScript numbers are never used for
 * money; all arithmetic goes through decimal.js. No rounding is applied here
 * — rounding rules await the accountant (Phase 7).
 */
const DECIMAL_PATTERN = /^\d{1,15}(\.\d{1,4})?$/;

export const MoneyStringSchema = z
  .string()
  .trim()
  .regex(DECIMAL_PATTERN, 'Use a non-negative amount with up to 4 decimals');
export const QuantityStringSchema = MoneyStringSchema.refine(
  (v) => new Decimal(v).gt(0),
  'Quantity must be greater than zero',
);

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO 4217 currency code');

const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });

/** Canonical 4-decimal string (exact; inputs have at most 4 decimals). */
export function toMoneyString(value: Decimal.Value): string {
  return new Dec(value).toFixed(4);
}

export const COVERAGES = ['CUSTOMER_PAY', 'WARRANTY', 'GOODWILL'] as const;
export type Coverage = (typeof COVERAGES)[number];

export interface PricedLine {
  readonly quantity: string;
  readonly unitPrice: string;
  readonly discount: string;
  readonly coverage: Coverage;
}

export interface LineAmounts {
  readonly gross: string;
  readonly net: string;
}

/** NUMERIC(19,4) holds at most 15 integer digits. */
const MAX_AMOUNT = new Dec('1e15');

/**
 * gross = quantity × unit price; net = gross − discount.
 * Returns null when the discount exceeds the line, the amount cannot be
 * stored, or quantity × price needs more than 4 decimals — that would require
 * rounding, and rounding rules are not yet approved (ADR 0005).
 */
export function computeLine(line: Omit<PricedLine, 'coverage'>): LineAmounts | null {
  // Malformed input (e.g. an empty field while typing) is "invalid", never an exception.
  if (![line.quantity, line.unitPrice, line.discount].every((v) => DECIMAL_PATTERN.test(v)))
    return null;
  const gross = new Dec(line.quantity).mul(line.unitPrice);
  const discount = new Dec(line.discount);
  if (discount.gt(gross) || gross.gte(MAX_AMOUNT) || gross.decimalPlaces() > 4) return null;
  return { gross: toMoneyString(gross), net: toMoneyString(gross.minus(discount)) };
}

export interface Totals {
  /** Sum of gross line amounts. */
  readonly subtotal: string;
  readonly discountTotal: string;
  /** Sum of net line amounts (all coverages). */
  readonly total: string;
  /** Net amount of CUSTOMER_PAY lines — what the customer is asked to approve. */
  readonly customerPayable: string;
  /** Net amount covered by warranty or goodwill. */
  readonly covered: string;
}

export function computeTotals(lines: readonly PricedLine[]): Totals | null {
  let subtotal = new Dec(0);
  let discountTotal = new Dec(0);
  let payable = new Dec(0);
  let covered = new Dec(0);
  for (const line of lines) {
    const amounts = computeLine(line);
    if (!amounts) return null;
    subtotal = subtotal.plus(amounts.gross);
    discountTotal = discountTotal.plus(line.discount);
    if (line.coverage === 'CUSTOMER_PAY') payable = payable.plus(amounts.net);
    else covered = covered.plus(amounts.net);
  }
  if (subtotal.gte(MAX_AMOUNT)) return null;
  return {
    subtotal: toMoneyString(subtotal),
    discountTotal: toMoneyString(discountTotal),
    total: toMoneyString(payable.plus(covered)),
    customerPayable: toMoneyString(payable),
    covered: toMoneyString(covered),
  };
}

/**
 * Display formatting only (never for calculation). Shows the exact stored
 * value (up to 4 decimals) — no rounding until rounding rules are approved.
 */
export function formatMoney(amount: string, currency: string, locale?: string): string {
  try {
    const base = new Intl.NumberFormat(locale, { style: 'currency', currency });
    const minimum = base.resolvedOptions().minimumFractionDigits ?? 2;
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: minimum,
      maximumFractionDigits: Math.max(minimum, 4),
    });
    // Intl accepts decimal strings exactly (no float conversion).
    return formatter.format(new Dec(amount).toFixed() as unknown as number);
  } catch {
    return `${currency} ${amount}`;
  }
}
