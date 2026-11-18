import { describe, expect, it } from 'vitest';

import {
  type DeliveryChallanSnapshot,
  renderDeliveryChallanHtml,
} from './delivery-challan.template.js';

const snapshot: DeliveryChallanSnapshot = {
  business: {
    name: 'Dev Org',
    header: '',
    branchName: 'Main',
    branchAddress: null,
    branchPhone: null,
  },
  challanNumber: 'DC-A1-2026-000001',
  status: 'COMPLETED',
  mode: 'Customer pick-up',
  date: '18 Nov 2026, 15:00',
  timeZone: 'UTC',
  customer: { name: 'Asha <script>', code: 'C000001', phone: '+91 98123 45678' },
  address: null,
  jobNumber: 'A1-2026-000001',
  device: { description: 'Laptop: Acme Book', serialNumber: 'SN-1' },
  items: [{ description: 'Charger & cable', returned: true, condition: 'Good' }],
  recipient: { name: 'Asha', relationship: 'Self', authorizationNote: null },
  balanceStatus: 'Nothing due',
  terms: 'Delivery terms to be confirmed by the business.',
  termsArePlaceholder: true,
  generatedAt: '18 Nov 2026',
};

describe('renderDeliveryChallanHtml', () => {
  it('includes required fields, escapes values and states it is not an invoice', () => {
    const html = renderDeliveryChallanHtml(snapshot, 'A4');
    for (const text of [
      'DC-A1-2026-000001',
      'A1-2026-000001',
      'SN-1',
      'Recipient signature',
      'not an invoice and not proof of payment',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('Asha &lt;script&gt;');
    expect(html).toContain('Charger &amp; cable');
    expect(html).toContain('terms placeholder');
  });

  it('marks failed attempts', () => {
    expect(renderDeliveryChallanHtml({ ...snapshot, status: 'FAILED' }, 'THERMAL_80')).toContain(
      'DELIVERY ATTEMPT FAILED',
    );
  });
});
