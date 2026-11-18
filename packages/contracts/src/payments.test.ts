import { describe, expect, it } from 'vitest';

import { RecordPaymentSchema, RefundSchema, looksLikeCardNumber } from './payments.js';
import { NumberFormatSchema, SETTINGS } from './settings.js';

const base = {
  branchId: '01a1eeac-6f23-74c8-bac5-000000000001',
  customerId: '01a1eeac-6f23-74c8-bac5-000000000002',
};

describe('payments', () => {
  it('detects card-like numbers (Luhn) without flagging ordinary references', () => {
    expect(looksLikeCardNumber('4111 1111 1111 1111')).toBe(true);
    expect(looksLikeCardNumber('4111-1111-1111-1112')).toBe(false);
    expect(looksLikeCardNumber('UTR123456789012')).toBe(false);
    expect(looksLikeCardNumber('000123')).toBe(false);
  });

  it('requires a reference except for cash and rejects card numbers', () => {
    expect(RecordPaymentSchema.safeParse({ ...base, amount: '100', method: 'CASH' }).success).toBe(
      true,
    );
    expect(RecordPaymentSchema.safeParse({ ...base, amount: '100', method: 'UPI' }).success).toBe(
      false,
    );
    expect(
      RecordPaymentSchema.safeParse({
        ...base,
        amount: '100',
        method: 'CARD_TERMINAL',
        reference: '4111111111111111',
      }).success,
    ).toBe(false);
    expect(
      RecordPaymentSchema.safeParse({
        ...base,
        amount: '100',
        method: 'CARD_TERMINAL',
        reference: 'AUTH 004512',
      }).success,
    ).toBe(true);
  });

  it('rejects zero, negative and over-precise amounts', () => {
    for (const amount of ['0', '0.0000', '-5', '1.23456']) {
      expect(RecordPaymentSchema.safeParse({ ...base, amount, method: 'CASH' }).success).toBe(
        false,
      );
    }
    expect(RefundSchema.safeParse({ amount: '10', method: 'CASH', reason: '' }).success).toBe(
      false,
    );
  });

  it('ships valid placeholder numbering formats', () => {
    expect(NumberFormatSchema.parse(SETTINGS['numbering.receiptNumber'].default)).toBeTruthy();
    expect(NumberFormatSchema.parse(SETTINGS['numbering.refundNumber'].default)).toBeTruthy();
  });
});
