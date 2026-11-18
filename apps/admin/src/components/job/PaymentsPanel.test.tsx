import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

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
