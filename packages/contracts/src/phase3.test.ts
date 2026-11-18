import { describe, expect, it } from 'vitest';

import { normalizeSerial } from './assets.js';
import {
  CustomerComplaintRequestSchema,
  CUSTOMER_STATUS_BY_JOB_STATUS,
  CUSTOMER_STATUS_LABELS,
  JOB_STATUSES,
} from './jobs.js';
import { normalizePhone } from './phone.js';
import { NumberFormatSchema, SETTINGS, formatNumber } from './settings.js';

describe('formatNumber', () => {
  it('fills branch, year and padded sequence', () => {
    expect(
      formatNumber('{BRANCH}-{YYYY}-{SEQ:6}', { sequence: 42, year: 2026, branchCode: 'DEV-01' }),
    ).toBe('DEV-01-2026-000042');
    expect(formatNumber('C{SEQ:6}', { sequence: 7n, year: 2026 })).toBe('C000007');
    expect(formatNumber('J{YY}/{SEQ:4}', { sequence: 12345, year: 2009 })).toBe('J09/12345');
  });
});

describe('NumberFormatSchema', () => {
  it('accepts the defaults', () => {
    expect(NumberFormatSchema.parse(SETTINGS['numbering.jobNumber'].default)).toBeTruthy();
    expect(NumberFormatSchema.parse(SETTINGS['numbering.customerCode'].default)).toBeTruthy();
  });

  it('rejects templates without exactly one sequence or with unknown tokens', () => {
    expect(
      NumberFormatSchema.safeParse({ template: '{BRANCH}-{YYYY}', reset: 'NEVER' }).success,
    ).toBe(false);
    expect(
      NumberFormatSchema.safeParse({ template: '{SEQ:4}{SEQ:4}', reset: 'NEVER' }).success,
    ).toBe(false);
    expect(
      NumberFormatSchema.safeParse({ template: '{EVIL}{SEQ:4}', reset: 'NEVER' }).success,
    ).toBe(false);
    expect(NumberFormatSchema.safeParse({ template: 'J-{SEQ:4}', reset: 'YEARLY' }).success).toBe(
      false,
    );
  });
});

describe('normalizePhone', () => {
  it('normalizes international numbers to E.164', () => {
    expect(normalizePhone('+91 98123 45678')).toEqual({
      e164: '+919812345678',
      display: '+91 98123 45678',
    });
  });

  it('requires a country code without a default region', () => {
    expect(normalizePhone('98123 45678')).toBeNull();
    expect(normalizePhone('98123 45678', 'IN')?.e164).toBe('+919812345678');
  });

  it('rejects junk', () => {
    expect(normalizePhone('hello')).toBeNull();
  });
});

describe('normalizeSerial', () => {
  it('ignores case, spaces and separators', () => {
    expect(normalizeSerial(' ab-12 34.x ')).toBe('AB1234X');
  });
});

describe('customer status mapping', () => {
  it('maps every internal status to a labelled customer status', () => {
    for (const status of JOB_STATUSES) {
      expect(CUSTOMER_STATUS_LABELS[CUSTOMER_STATUS_BY_JOB_STATUS[status]]).toBeTruthy();
    }
  });
});

describe('CustomerComplaintRequestSchema', () => {
  const base = {
    branchId: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e4',
    warrantyClaim: 'NOT_SURE',
    serviceMode: 'AT_SERVICE_CENTRE',
    complaint: 'Laptop does not turn on',
  };

  it('requires exactly one of assetId or newAsset', () => {
    expect(CustomerComplaintRequestSchema.safeParse(base).success).toBe(false);
    expect(
      CustomerComplaintRequestSchema.safeParse({
        ...base,
        assetId: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e5',
      }).success,
    ).toBe(true);
  });

  it('requires an address for on-site service', () => {
    const value = {
      ...base,
      assetId: '01a1eeac-6f23-74c8-bac5-bb6d4e1254e5',
      serviceMode: 'ON_SITE',
    };
    expect(CustomerComplaintRequestSchema.safeParse(value).success).toBe(false);
  });
});
