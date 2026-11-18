import { describe, expect, it } from 'vitest';

import {
  type PaymentReceiptSnapshot,
  renderPaymentReceiptHtml,
} from './payment-receipt.template.js';

const snapshot: PaymentReceiptSnapshot = {
  business: { name: 'Dev Org', header: '', branchName: 'Main' },
  receiptNumber: 'RCPT-A1-2026-000001',
  receivedAt: '18 Nov 2026, 14:05',
  timeZone: 'UTC',
  customer: { name: '<img src=x onerror=alert(1)>', code: 'C000001' },
  jobNumber: 'A1-2026-000001',
  amount: 'XXX 1,000.00',
  method: 'UPI',
  reference: 'UTR123',
  status: 'RECORDED',
  reversalReason: null,
  footer: 'Tax treatment of this payment to be confirmed.',
  footerIsPlaceholder: true,
  generatedAt: '18 Nov 2026',
};

describe('renderPaymentReceiptHtml', () => {
  it('escapes values, states it is not an invoice and marks placeholder wording', () => {
    const html = renderPaymentReceiptHtml(snapshot, 'A4');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('It is not an invoice.');
    expect(html).toContain('class="footer placeholder"');
    expect(html).not.toContain('REVERSED');
  });

  it('shows reversal prominently', () => {
    const html = renderPaymentReceiptHtml(
      { ...snapshot, status: 'REVERSED', reversalReason: 'Cheque bounced' },
      'THERMAL_80',
    );
    expect(html).toContain('REVERSED — this payment was reversed: Cheque bounced');
    expect(html).toContain('size: 80mm auto');
  });
});
