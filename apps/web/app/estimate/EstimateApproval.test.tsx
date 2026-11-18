import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EstimateApproval } from './EstimateApproval';

const TOKEN = 'A'.repeat(43);
const ESTIMATE = {
  id: 'e1',
  version: 1,
  status: 'SENT',
  expired: false,
  currency: 'USD',
  subtotal: '1100.0000',
  discountTotal: '0.0000',
  total: '1100.0000',
  customerPayable: '1000.0000',
  covered: '100.0000',
  taxNote: 'Taxes, if applicable, to be confirmed.',
  validUntil: '2026-12-02',
  terms: 'Placeholder terms.',
  notes: null,
  lines: [
    {
      id: 'l1',
      position: 1,
      lineType: 'PART',
      description: 'Keyboard',
      sku: null,
      quantity: '1.0000',
      unit: 'EA',
      unitPrice: '1000.0000',
      discount: '0.0000',
      coverage: 'CUSTOMER_PAY',
      lineTotal: '1000.0000',
    },
    {
      id: 'l2',
      position: 2,
      lineType: 'LABOUR',
      description: 'Labour',
      sku: null,
      quantity: '1.0000',
      unit: 'EA',
      unitPrice: '100.0000',
      discount: '0.0000',
      coverage: 'GOODWILL',
      lineTotal: '100.0000',
    },
  ],
  sentAt: '2026-11-18T10:00:00.000Z',
  decision: null,
  jobNumber: 'A1-2026-000001',
  businessName: 'Dev Org',
  device: 'Laptop: Acme Book',
};

function fakeFetch(
  handler: (path: string, body: Record<string, unknown>) => { status: number; body: unknown },
) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const raw = init?.body;
    const { status, body } = handler(
      url.split('/api/v1')[1] ?? '',
      JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>,
    );
    await Promise.resolve();
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('EstimateApproval', () => {
  it('reads the token from the fragment, removes it from the address bar, and shows the estimate', async () => {
    window.history.replaceState(null, '', `/estimate#token=${TOKEN}`);
    const fetchImpl = fakeFetch(() => ({ status: 200, body: ESTIMATE }));
    render(<EstimateApproval fetchImpl={fetchImpl} />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Repair estimate' }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(screen.getByText('$1,000.00', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByText('Taxes, if applicable, to be confirmed.')).toBeInTheDocument();
    expect(screen.getByText('No charge (goodwill)')).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/public/estimate-links/view'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('requires accepting the terms and confirming before approving', async () => {
    window.history.replaceState(null, '', `/estimate#token=${TOKEN}`);
    const decisions: Record<string, unknown>[] = [];
    const fetchImpl = fakeFetch((path, body) => {
      if (path.endsWith('/decision')) {
        decisions.push(body);
        return { status: 200, body: { ...ESTIMATE, status: 'APPROVED' } };
      }
      return { status: 200, body: ESTIMATE };
    });
    render(<EstimateApproval fetchImpl={fetchImpl} />);
    const user = userEvent.setup();
    const approve = await screen.findByRole('button', { name: 'Approve estimate' });
    expect(approve).toBeDisabled();
    await user.click(screen.getByLabelText('I have read and accept the terms'));
    await user.click(approve);
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Approve $1,000.00?');
    expect(decisions).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Yes, approve' }));
    expect(
      await screen.findByRole('heading', { name: 'Thank you — estimate approved' }),
    ).toBeInTheDocument();
    expect(decisions).toEqual([{ token: TOKEN, decision: 'APPROVED', termsAccepted: true }]);
  });

  it('explains invalid, used or missing links', async () => {
    window.history.replaceState(null, '', `/estimate#token=${TOKEN}`);
    const fetchImpl = fakeFetch(() => ({
      status: 400,
      body: {
        error: {
          code: 'INVALID_TOKEN',
          message:
            'This link is invalid, already used or expired. Please contact the service centre.',
        },
      },
    }));
    render(<EstimateApproval fetchImpl={fetchImpl} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already used or expired/);

    window.history.replaceState(null, '', '/estimate');
    render(<EstimateApproval fetchImpl={fetchImpl} />);
    await waitFor(() =>
      expect(screen.getAllByRole('alert').at(-1)).toHaveTextContent(/incomplete/),
    );
  });
});
