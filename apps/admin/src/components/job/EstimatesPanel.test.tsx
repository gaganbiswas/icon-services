import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';
import { EstimatesPanel, approvalUrl } from './EstimatesPanel';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};
const JOB = { id: 'job-1', status: 'ESTIMATE_PREPARATION', version: 3 } as never;
const DRAFT = {
  id: 'est-1',
  jobId: 'job-1',
  version: 1,
  status: 'DRAFT',
  expired: false,
  currency: 'USD',
  subtotal: '100.0000',
  discountTotal: '0.0000',
  total: '100.0000',
  customerPayable: '100.0000',
  covered: '0.0000',
  taxNote: 'Taxes, if applicable, to be confirmed.',
  validUntil: null,
  terms: 'x',
  notes: null,
  lines: [
    {
      id: 'l1',
      position: 1,
      lineType: 'LABOUR',
      description: 'Fix',
      sku: null,
      quantity: '1.0000',
      unit: 'EA',
      unitPrice: '100.0000',
      discount: '0.0000',
      coverage: 'CUSTOMER_PAY',
      lineTotal: '100.0000',
    },
  ],
  sentAt: null,
  decision: null,
  rowVersion: 2,
};

function setup(currency: string | null, estimates: unknown[] = []) {
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me')
      return json(200, {
        ...ME,
        permissions: ['estimates.read', 'estimates.write', 'estimates.send'],
      });
    if (path === '/estimates/config') return json(200, { currency, validityDays: 14 });
    if (path === '/jobs/job-1/estimates') return json(200, estimates);
    if (path === '/estimates/est-1/send' && init.method === 'POST')
      return json(200, {
        estimate: { ...DRAFT, status: 'SENT' },
        approvalLink: { token: 'T'.repeat(43), expiresAt: '2026-12-02T00:00:00.000Z' },
      });
    return json(404, {});
  });
  render(
    <AuthProvider client={client}>
      <EstimatesPanel job={JOB} onChanged={() => undefined} />
    </AuthProvider>,
  );
  return calls;
}

describe('EstimatesPanel', () => {
  it('blocks drafting until the currency is configured', async () => {
    setup(null);
    expect(await screen.findByText(/currency is not configured/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save draft' })).toBeNull();
  });

  it('previews totals with the shared calculation', async () => {
    setup('USD');
    const user = userEvent.setup();
    const price = await screen.findByLabelText('Unit price');
    await user.clear(price);
    await user.type(price, '1200.50');
    await user.clear(screen.getByLabelText('Discount (amount)'));
    await user.type(screen.getByLabelText('Discount (amount)'), '0.50');
    expect(screen.getByText('$1,200.00', { selector: 'strong' })).toBeInTheDocument();
  });

  it('shows the approval link once after sending, with the token in the fragment', async () => {
    const calls = setup('USD', [DRAFT]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Send version 1 to customer' }));
    await waitFor(() => expect(screen.getByText(approvalUrl('T'.repeat(43)))).toBeInTheDocument());
    expect(approvalUrl('abc')).toMatch(/\/estimate#token=abc$/);
    const send = calls.find((c) => c.url.endsWith('/estimates/est-1/send'));
    const raw = send?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({ rowVersion: 2 });
  });
});
