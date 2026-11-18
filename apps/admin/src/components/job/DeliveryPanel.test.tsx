import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';
import { DeliveryPanel } from './DeliveryPanel';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};
const JOB = { id: 'job-1', status: 'READY_FOR_DELIVERY', version: 9 } as never;

function setup(permissions: string[], due: string) {
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me') return json(200, { ...ME, permissions });
    if (path === '/jobs/job-1/deliveries')
      return json(200, {
        deliveries: [],
        balance: {
          currency: 'USD',
          billed: '100.0000',
          paid: '0.0000',
          due,
          basis: 'APPROVED_ESTIMATE',
        },
        requiredItems: ['Laptop: Acme Book', 'Charger'],
      });
    if (path === '/jobs/job-1/deliveries/handover' && init.method === 'POST') return json(201, {});
    return json(404, {});
  });
  render(
    <AuthProvider client={client}>
      <DeliveryPanel job={JOB} onChanged={() => undefined} />
    </AuthProvider>,
  );
  return calls;
}

describe('DeliveryPanel', () => {
  it('blocks hand-over with a balance due for staff without the override permission', async () => {
    setup(['deliveries.read', 'deliveries.write', 'deliveries.complete'], '100.0000');
    expect(
      await screen.findByText(/A manager must approve delivery with a balance due/),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete hand-over' })).toBeDisabled();
  });

  it('sends every required item, proof and an idempotency key', async () => {
    const calls = setup(['deliveries.read', 'deliveries.complete'], '0.0000');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Recipient name'), 'Asha');
    await user.click(screen.getByLabelText('Laptop: Acme Book'));
    await user.click(screen.getByLabelText('Charger'));
    await user.click(screen.getByRole('button', { name: 'Complete hand-over' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/deliveries/handover'))).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith('/deliveries/handover'));
    expect((post?.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
    const raw = post?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toMatchObject({
      version: 9,
      mode: 'CUSTOMER_PICKUP',
      recipientName: 'Asha',
      relationship: 'SELF',
      items: [
        { description: 'Laptop: Acme Book', returned: true },
        { description: 'Charger', returned: true },
      ],
      proofMethod: 'SIGNED_CHALLAN',
    });
  });
});
