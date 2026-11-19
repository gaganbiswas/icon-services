import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';
import { PaymentsPanel } from './PaymentsPanel';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};
const JOB = { id: 'job-1', branch: { id: 'b1' }, customer: { id: 'c1' } } as never;

function setup(onPost: (attempt: number) => { status: number; body?: unknown }) {
  let attempts = 0;
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me')
      return json(200, { ...ME, permissions: ['payments.read', 'payments.record'] });
    if (path.startsWith('/payments?'))
      return json(200, { items: [], page: 1, pageSize: 100, total: 0 });
    if (path === '/payments' && init.method === 'POST') {
      attempts += 1;
      return onPost(attempts);
    }
    return json(404, {});
  });
  render(
    <AuthProvider client={client}>
      <PaymentsPanel job={JOB} />
    </AuthProvider>,
  );
  return calls;
}

describe('PaymentsPanel', () => {
  it('asks for a reference only for non-cash methods', async () => {
    setup(() => json(201, {}));
    const user = userEvent.setup();
    await screen.findByLabelText('Amount');
    expect(screen.queryByLabelText(/Transaction reference/)).toBeNull();
    await user.selectOptions(screen.getByLabelText('Method'), 'UPI');
    expect(screen.getByLabelText(/never a card number/)).toBeInTheDocument();
  });

  it('retries a failed recording with the same Idempotency-Key', async () => {
    const calls = setup((attempt) =>
      attempt === 1
        ? json(503, { error: { code: 'INTERNAL_ERROR', message: 'Try again' } })
        : json(201, {}),
    );
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Amount'), '500');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(await screen.findAllByText('Try again')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(
        calls.filter((c) => c.url.endsWith('/payments') && c.init.method === 'POST'),
      ).toHaveLength(2),
    );
    const keys = calls
      .filter((c) => c.url.endsWith('/payments') && c.init.method === 'POST')
      .map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    const raw = calls.find((c) => c.url.endsWith('/payments') && c.init.method === 'POST')?.init
      .body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      branchId: 'b1',
      customerId: 'c1',
      jobId: 'job-1',
      amount: '500',
      method: 'CASH',
    });
  });
});

describe('PaymentsPanel refunds', () => {
  it('collects refund details in a dialog instead of browser prompts', async () => {
    const payment = {
      id: 'p1',
      receiptNumber: 'RCPT-1',
      customerId: 'c1',
      jobId: 'job-1',
      jobNumber: 'A1-1',
      branchId: 'b1',
      currency: 'INR',
      amount: '1000.0000',
      method: 'UPI',
      reference: 'UTR1',
      receivedAt: '2026-11-19T10:00:00.000Z',
      receivedBy: { id: 'u', fullName: 'Arjun' },
      notes: null,
      status: 'RECORDED',
      allocated: '0.0000',
      refunded: '0.0000',
      onAccount: '1000.0000',
      reversedAt: null,
      reversalReason: null,
      refunds: [],
      createdAt: '2026-11-19T10:00:00.000Z',
    };
    const { client, calls } = fakeClient((url, init) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, TOKEN);
      if (path === '/me')
        return json(200, {
          ...ME,
          permissions: ['payments.read', 'payments.record', 'payments.refund'],
        });
      if (path.startsWith('/payments?'))
        return json(200, { items: [payment], page: 1, pageSize: 100, total: 1 });
      if (path === '/payments/p1/refunds' && init.method === 'POST') return json(201, payment);
      return json(404, {});
    });
    const prompt = vi.spyOn(window, 'prompt');
    render(
      <AuthProvider client={client}>
        <PaymentsPanel job={JOB} />
      </AuthProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Refund' }));
    const dialog = screen.getByRole('dialog', { name: 'Refund from RCPT-1' });
    await user.type(within(dialog).getByLabelText('Amount'), '200');
    await user.type(within(dialog).getByLabelText('Refund transaction reference'), 'UTR9');
    await user.type(within(dialog).getByLabelText('Reason'), 'Overpaid');
    await user.click(within(dialog).getByRole('button', { name: 'Refund' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/payments/p1/refunds'))).toBe(true),
    );
    const raw = calls.find((c) => c.url.endsWith('/payments/p1/refunds'))?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      amount: '200',
      method: 'UPI',
      reason: 'Overpaid',
      reference: 'UTR9',
    });
    expect(prompt).not.toHaveBeenCalled();
  });
});
