import { describe, expect, it } from 'vitest';

import {
  GstInputError,
  computeGstLine,
  computeGstTotals,
  summarizeByHsn,
  supplyTypeFor,
} from './gst.js';
import {
  amountInWordsINR,
  financialYear,
  isValidGstin,
  stateCodeFromGstin,
  stateCodeFromName,
} from './india.js';
import { NumberFormatSchema, SETTINGS, TaxSettingsSchema, formatNumber } from './settings.js';

// Hand-computed vectors for the ADR 0022 defaults. NOT accountant-approved test vectors (owner question 27).
describe('GST line calculation', () => {
  it('splits intra-state tax into CGST and SGST', () => {
    expect(
      computeGstLine(
        { quantity: '1', unitPrice: '2500', discount: '0', gstRate: '18' },
        'INTRA_STATE',
      ),
    ).toEqual({
      taxableValue: '2500.00',
      cgstRate: '9',
      sgstRate: '9',
      igstRate: '0',
      cgstAmount: '225.00',
      sgstAmount: '225.00',
      igstAmount: '0.00',
      lineTotal: '2950.00',
    });
  });

  it('charges IGST inter-state and applies discount before tax', () => {
    expect(
      computeGstLine(
        { quantity: '2', unitPrice: '1050', discount: '100', gstRate: '18' },
        'INTER_STATE',
      ),
    ).toMatchObject({
      taxableValue: '2000.00',
      igstRate: '18',
      igstAmount: '360.00',
      cgstAmount: '0.00',
      lineTotal: '2360.00',
    });
  });

  it('rounds each component half-up to paise', () => {
    // 333.33 × 9 % = 29.9997 → 30.00; ×2 components
    const line = computeGstLine(
      { quantity: '3', unitPrice: '111.11', discount: '0', gstRate: '18' },
      'INTRA_STATE',
    );
    expect(line).toMatchObject({
      taxableValue: '333.33',
      cgstAmount: '30.00',
      sgstAmount: '30.00',
      lineTotal: '393.33',
    });
    // 0.125 → 0.13 (half-up), not banker's rounding
    expect(
      computeGstLine(
        { quantity: '1', unitPrice: '1.3889', discount: '0', gstRate: '18' },
        'INTRA_STATE',
      ).cgstAmount,
    ).toBe('0.13');
  });

  it('rejects impossible input', () => {
    expect(() =>
      computeGstLine(
        { quantity: '0', unitPrice: '1', discount: '0', gstRate: '18' },
        'INTRA_STATE',
      ),
    ).toThrow(GstInputError);
    expect(() =>
      computeGstLine(
        { quantity: '1', unitPrice: '10', discount: '11', gstRate: '18' },
        'INTRA_STATE',
      ),
    ).toThrow(GstInputError);
    expect(() =>
      computeGstLine(
        { quantity: '1', unitPrice: '10', discount: '0', gstRate: '101' },
        'INTRA_STATE',
      ),
    ).toThrow(GstInputError);
  });
});

describe('GST totals', () => {
  it('rounds the grand total to the rupee with a visible round-off', () => {
    const a = computeGstLine(
      { quantity: '3', unitPrice: '111.11', discount: '0', gstRate: '18' },
      'INTRA_STATE',
    );
    const b = computeGstLine(
      { quantity: '1', unitPrice: '99.99', discount: '0', gstRate: '18' },
      'INTRA_STATE',
    );
    // taxable 433.32; tax 30+30+9.00+9.00 = 78.00 → 511.32 → 511.00, round-off −0.32
    expect(computeGstTotals([a, b], 'NEAREST_RUPEE')).toEqual({
      taxableTotal: '433.32',
      cgstTotal: '39.00',
      sgstTotal: '39.00',
      igstTotal: '0.00',
      taxTotal: '78.00',
      roundOff: '-0.32',
      total: '511.00',
    });
    expect(computeGstTotals([a, b], 'NONE')).toMatchObject({ roundOff: '0.00', total: '511.32' });
  });

  it('rounds .50 up', () => {
    const l = computeGstLine(
      { quantity: '1', unitPrice: '0.4237', discount: '0', gstRate: '18' },
      'INTER_STATE',
    );
    // taxable 0.42, igst 0.08 → 0.50 → 1.00
    expect(computeGstTotals([l], 'NEAREST_RUPEE')).toMatchObject({
      total: '1.00',
      roundOff: '0.50',
    });
  });

  it('summarises by HSN/SAC and rate', () => {
    const s = computeGstLine(
      { quantity: '1', unitPrice: '500', discount: '0', gstRate: '18' },
      'INTRA_STATE',
    );
    const p = computeGstLine(
      { quantity: '2', unitPrice: '1000', discount: '0', gstRate: '18' },
      'INTRA_STATE',
    );
    expect(
      summarizeByHsn([
        { ...s, hsnSac: '998713', gstRate: '18' },
        { ...p, hsnSac: '8473', gstRate: '18.00' },
        { ...s, hsnSac: '998713', gstRate: '18' },
      ]),
    ).toEqual([
      {
        hsnSac: '8473',
        gstRate: '18',
        taxableValue: '2000.00',
        cgstAmount: '180.00',
        sgstAmount: '180.00',
        igstAmount: '0.00',
      },
      {
        hsnSac: '998713',
        gstRate: '18',
        taxableValue: '1000.00',
        cgstAmount: '90.00',
        sgstAmount: '90.00',
        igstAmount: '0.00',
      },
    ]);
  });

  it('decides intra/inter-state from state codes', () => {
    expect(supplyTypeFor('19', '19')).toBe('INTRA_STATE');
    expect(supplyTypeFor('19', '27')).toBe('INTER_STATE');
  });
});

describe('India helpers', () => {
  it('validates GSTINs with the check digit', () => {
    expect(isValidGstin('19AHDPB5074F1ZK')).toBe(true);
    expect(isValidGstin('19ahdpb5074f1zk')).toBe(true);
    expect(isValidGstin('19AHDPB5074F1ZJ')).toBe(false);
    expect(isValidGstin('99AHDPB5074F1ZK')).toBe(false);
    expect(stateCodeFromGstin('19AHDPB5074F1ZK')).toBe('19');
    expect(stateCodeFromName('West Bengal')).toBe('19');
    expect(stateCodeFromName('Andaman & Nicobar Islands')).toBe('35');
    expect(stateCodeFromName('Atlantis')).toBeNull();
  });

  it('computes the financial year in the business time zone', () => {
    expect(financialYear(new Date('2026-04-01T00:00:00+05:30'), 4, 'Asia/Kolkata')).toEqual({
      startYear: 2026,
      label: '2026-27',
      short: '2627',
    });
    // 31 March 23:00 IST is still the old year, even though UTC says 31 March 17:30.
    expect(financialYear(new Date('2027-03-31T23:00:00+05:30'), 4, 'Asia/Kolkata').label).toBe(
      '2026-27',
    );
    expect(financialYear(new Date('2026-03-31T20:00:00Z'), 4, 'Asia/Kolkata').label).toBe(
      '2026-27',
    );
    expect(financialYear(new Date('2026-06-01T00:00:00Z'), 1, 'UTC')).toMatchObject({
      label: '2026',
    });
  });

  it('writes amounts in words with Indian grouping', () => {
    expect(amountInWordsINR('2950.00')).toBe('Two Thousand Nine Hundred Fifty Rupees Only');
    expect(amountInWordsINR('123456.50')).toBe(
      'One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Fifty Paise Only',
    );
    expect(amountInWordsINR('10000000')).toBe('One Crore Rupees Only');
    expect(amountInWordsINR('0.00')).toBe('Zero Rupees Only');
  });
});

describe('invoice settings', () => {
  it('default invoice number fits the 16-character GST limit', () => {
    const fmt = SETTINGS['numbering.invoiceNumber'].default;
    expect(NumberFormatSchema.parse(fmt)).toBeTruthy();
    const n = formatNumber(fmt.template, {
      sequence: 999999,
      year: 2026,
      fy: { label: '2026-27', short: '2627' },
    });
    expect(n).toBe('INV-2627-999999');
    expect(n.length).toBeLessThanOrEqual(16);
    expect(
      NumberFormatSchema.safeParse({ template: 'INV-{SEQ:5}', reset: 'FINANCIAL_YEAR' }).success,
    ).toBe(false);
  });

  it('ships tax settings as an unapproved draft and requires an approver to approve', () => {
    const t = SETTINGS.tax.default;
    expect(t.status).toBe('DRAFT');
    expect(TaxSettingsSchema.safeParse(t).success).toBe(true);
    expect(TaxSettingsSchema.safeParse({ ...t, status: 'APPROVED' }).success).toBe(false);
    expect(
      TaxSettingsSchema.safeParse({
        ...t,
        status: 'APPROVED',
        approval: { approvedBy: 'CA R. Sen', approvedOn: '2026-11-20', note: null },
      }).success,
    ).toBe(true);
    expect(
      TaxSettingsSchema.safeParse({
        ...t,
        lineTypeCategory: { ...t.lineTypeCategory, PART: 'MISSING' },
      }).success,
    ).toBe(false);
  });
});
