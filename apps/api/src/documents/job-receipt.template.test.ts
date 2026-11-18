import { describe, expect, it } from 'vitest';

import { type JobReceiptSnapshot, renderJobReceiptHtml } from './job-receipt.template.js';

const snapshot: JobReceiptSnapshot = {
  business: {
    name: 'Dev Org',
    header: '',
    branchName: 'Main',
    branchAddress: null,
    branchPhone: null,
  },
  job: {
    number: 'DEV-01-2026-000001',
    receivedAt: '18 Nov 2026, 14:05',
    timeZone: 'UTC',
    serviceType: 'Out of warranty',
    serviceMode: 'At service centre',
    status: 'Device received',
    expectedCompletionDate: null,
  },
  customer: { name: 'राम <b>Kumar</b>', code: 'C000001', phone: '+91 98123 45678', email: null },
  device: { category: 'Laptop', brand: 'Acme', model: 'X1', serialNumber: 'SN-1', assetTag: null },
  complaint: '<script>alert("x")</script> screen flickers',
  accessories: ['Charger', 'Bag & strap'],
  checklist: [{ item: 'Device powers on', checked: true }],
  conditionNotes: null,
  terms: 'Terms and conditions to be confirmed by the business.',
  termsArePlaceholder: true,
  generatedAt: '18 Nov 2026, 14:06 (UTC)',
};

describe('renderJobReceiptHtml', () => {
  it('escapes all user-provided text', () => {
    const html = renderJobReceiptHtml(snapshot, 'A4');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('राम &lt;b&gt;Kumar&lt;/b&gt;');
    expect(html).toContain('Bag &amp; strap');
  });

  it('includes required receipt fields and marks placeholder terms', () => {
    const html = renderJobReceiptHtml(snapshot, 'A4');
    for (const text of [
      'DEV-01-2026-000001',
      'C000001',
      'Acme X1',
      'SN-1',
      'Customer signature',
      'Received by (staff)',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('class="terms placeholder"');
  });

  it('switches page size for thermal printers', () => {
    expect(renderJobReceiptHtml(snapshot, 'THERMAL_80')).toContain('size: 80mm auto');
    expect(renderJobReceiptHtml(snapshot, 'A4')).toContain('size: A4');
  });
});
