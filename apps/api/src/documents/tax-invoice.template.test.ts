import { describe, expect, it } from 'vitest';

import { type TaxDocSnapshot, renderTaxDocumentHtml } from './tax-invoice.template.js';

const base: TaxDocSnapshot = {
  kind: 'TAX_INVOICE',
  number: 'INV-2627-000001',
  date: '2026-11-19',
  reference: null,
  reason: null,
  supplier: {
    name: 'ICON INFOSYS',
    gstin: '19AHDPB5074F1ZK',
    address: 'MIG-7, Nilganj Road, Sodepur, Kolkata - 700110, West Bengal',
    stateCode: '19',
    stateName: 'West Bengal',
  },
  recipient: {
    name: 'Asha <Rao>',
    gstin: null,
    address: 'Kolkata',
    stateCode: '19',
    stateName: 'West Bengal',
  },
  supplyType: 'INTRA_STATE',
  placeOfSupply: { code: '19', name: 'West Bengal' },
  jobNumber: 'A1-2026-000001',
  currency: 'INR',
  lines: [
    {
      description: 'Keyboard',
      hsnSac: '8473',
      quantity: '1',
      unit: 'NOS',
      unitPrice: '2500.00',
      discount: '0.00',
      taxableValue: '2500.00',
      gstRate: '18',
      cgstAmount: '225.00',
      sgstAmount: '225.00',
      igstAmount: '0.00',
    },
  ],
  hsnSummary: [
    {
      hsnSac: '8473',
      gstRate: '18',
      taxableValue: '2500.00',
      cgstAmount: '225.00',
      sgstAmount: '225.00',
      igstAmount: '0.00',
    },
  ],
  totals: {
    taxable: '2500.00',
    cgst: '225.00',
    sgst: '225.00',
    igst: '0.00',
    roundOff: '0.00',
    total: '2950.00',
  },
  amountInWords: 'Two Thousand Nine Hundred Fifty Rupees Only',
  terms: 'Terms <b>',
  termsArePlaceholder: true,
  declaration: null,
  signatory: { name: null, designation: null },
  contact: '98303 77112 · info@iconinfosys.co.in',
  generatedAt: '2026-11-19 10:00',
};

describe('tax invoice template', () => {
  it('prints the GST fields for an intra-state supply', () => {
    const html = renderTaxDocumentHtml(base);
    for (const text of [
      'Tax Invoice',
      'INV-2627-000001',
      '19AHDPB5074F1ZK',
      'West Bengal (19)',
      'CGST',
      'SGST',
      '@9%',
      'Reverse charge: No',
      'Two Thousand Nine Hundred Fifty Rupees Only',
      'Authorised Signatory',
      'For ICON INFOSYS',
      'Unregistered',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('IGST</th>');
    expect(html).toContain('Asha &lt;Rao&gt;');
    expect(html).toContain('Terms &lt;b&gt;');
    expect(html).toContain('placeholder');
  });

  it('prints IGST for inter-state supplies and credit-note specifics', () => {
    const html = renderTaxDocumentHtml({
      ...base,
      kind: 'CREDIT_NOTE',
      number: 'CN-2627-000001',
      reference: { label: 'Against invoice', value: 'INV-2627-000001' },
      reason: 'Part returned',
      supplyType: 'INTER_STATE',
      placeOfSupply: { code: '27', name: 'Maharashtra' },
      lines: [{ ...base.lines[0]!, cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '450.00' }],
      totals: { ...base.totals, cgst: '0.00', sgst: '0.00', igst: '450.00', roundOff: '-0.40' },
    });
    for (const text of [
      'Credit Note',
      'Against invoice',
      'Reason: Part returned',
      'IGST',
      '@18%',
      'Maharashtra (27)',
      'Round off',
      'Credit total',
    ])
      expect(html).toContain(text);
    expect(html).not.toContain('<th class="num">CGST</th>');
  });

  it('prints a Bill of Supply without any GST columns, totals or summary', () => {
    const html = renderTaxDocumentHtml({
      ...base,
      kind: 'BILL_OF_SUPPLY',
      totals: { ...base.totals, cgst: '0.00', sgst: '0.00', igst: '0.00' },
    });
    expect(html).toContain('<h1>Bill of Supply</h1>');
    expect(html).toContain('No GST charged');
    expect(html).toContain('Bill to');
    for (const text of [
      'CGST',
      'SGST',
      'IGST',
      'GST rate',
      'Taxable value',
      'Reverse charge',
      'Tax Invoice',
    ])
      expect(html).not.toContain(text);
  });

  it('prints a credit note against a Bill of Supply without GST', () => {
    const html = renderTaxDocumentHtml({ ...base, kind: 'CREDIT_NOTE', withoutGst: true });
    expect(html).toContain('<h1>Credit Note</h1>');
    expect(html).not.toContain('CGST');
    expect(html).toContain('Credit total');
  });
});
