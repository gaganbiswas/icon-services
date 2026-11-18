import { describe, expect, it } from 'vitest';

import { EstimateDecisionSchema, EstimateLineInputSchema } from './estimates.js';
import { MoneyStringSchema, computeLine, computeTotals, formatMoney } from './money.js';

describe('money', () => {
  it('validates decimal strings with up to 4 decimals and no negatives', () => {
    expect(MoneyStringSchema.safeParse('1250.50').success).toBe(true);
    expect(MoneyStringSchema.safeParse('0.0001').success).toBe(true);
    expect(MoneyStringSchema.safeParse('1.23456').success).toBe(false);
    expect(MoneyStringSchema.safeParse('-1').success).toBe(false);
    expect(MoneyStringSchema.safeParse('1e3').success).toBe(false);
  });

  it('computes exactly where floating point would not', () => {
    expect(computeLine({ quantity: '3', unitPrice: '0.1', discount: '0' })).toEqual({
      gross: '0.3000',
      net: '0.3000',
    });
    expect(computeLine({ quantity: '1.5', unitPrice: '333.3332', discount: '0.0001' })).toEqual({
      gross: '499.9998',
      net: '499.9997',
    });
    // 1.5 × 333.3333 = 499.99995 would need rounding → rejected, never silently rounded.
    expect(computeLine({ quantity: '1.5', unitPrice: '333.3333', discount: '0' })).toBeNull();
    // Amounts that NUMERIC(19,4) cannot store are rejected rather than truncated.
    expect(
      computeLine({ quantity: '999999999999999', unitPrice: '999999999999999', discount: '0' }),
    ).toBeNull();
  });

  it('treats malformed input as invalid instead of throwing', () => {
    expect(computeLine({ quantity: '', unitPrice: '10', discount: '0' })).toBeNull();
    expect(computeLine({ quantity: '1', unitPrice: 'abc', discount: '0' })).toBeNull();
    expect(
      computeTotals([{ quantity: '1', unitPrice: '', discount: '0', coverage: 'CUSTOMER_PAY' }]),
    ).toBeNull();
  });

  it('rejects discounts larger than the line', () => {
    expect(computeLine({ quantity: '1', unitPrice: '10', discount: '10.0001' })).toBeNull();
  });

  it('separates customer-payable from warranty and goodwill coverage', () => {
    expect(
      computeTotals([
        { quantity: '1', unitPrice: '1200', discount: '200', coverage: 'CUSTOMER_PAY' },
        { quantity: '2', unitPrice: '450.25', discount: '0', coverage: 'WARRANTY' },
        { quantity: '1', unitPrice: '300', discount: '0', coverage: 'GOODWILL' },
      ]),
    ).toEqual({
      subtotal: '2400.5000',
      discountTotal: '200.0000',
      total: '2200.5000',
      customerPayable: '1000.0000',
      covered: '1200.5000',
    });
  });

  it('formats for display without changing values', () => {
    expect(formatMoney('1000.5000', 'USD', 'en-US')).toBe('$1,000.50');
    expect(formatMoney('12.3456', 'USD', 'en-US')).toBe('$12.3456');
    expect(formatMoney('0.1000', 'JPY', 'en-US')).toBe('¥0.1');
  });
});

describe('estimate schemas', () => {
  it('defaults line discount, unit and coverage', () => {
    expect(
      EstimateLineInputSchema.parse({
        lineType: 'LABOUR',
        description: 'Fix',
        quantity: '1',
        unitPrice: '500',
      }),
    ).toMatchObject({
      discount: '0',
      unit: 'EA',
      coverage: 'CUSTOMER_PAY',
    });
  });

  it('requires accepting terms to approve but not to reject', () => {
    expect(EstimateDecisionSchema.safeParse({ decision: 'APPROVED' }).success).toBe(false);
    expect(
      EstimateDecisionSchema.safeParse({ decision: 'APPROVED', termsAccepted: true }).success,
    ).toBe(true);
    expect(EstimateDecisionSchema.safeParse({ decision: 'REJECTED' }).success).toBe(true);
  });
});
