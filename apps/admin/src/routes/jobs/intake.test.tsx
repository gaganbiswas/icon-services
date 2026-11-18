import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { createAppRouter } from '../../router';
import { ME, fakeClient, json } from '../../test/fake-api';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};
const STAFF = {
  ...ME,
  permissions: [
    'jobs.read',
    'jobs.create',
    'customers.read',
    'customers.write',
    'assets.read',
    'assets.write',
  ],
};
const CUSTOMER = {
  id: '01a1eeac-6f23-74c8-bac5-000000000001',
  customerCode: 'C000001',
  type: 'INDIVIDUAL',
  name: 'Asha Rao',
  phone: '+91 98123 45678',
  email: null,
  activeConsents: [],
};
const DEVICE = {
  id: '01a1eeac-6f23-74c8-bac5-000000000002',
  customerId: CUSTOMER.id,
  category: { id: '01a1eeac-6f23-74c8-bac5-000000000003', code: 'LAPTOP', name: 'Laptop' },
  brand: 'Acme',
  model: 'Book 14',
  serialNumber: 'SN1',
};
const BRANCH = {
  id: '01a1eeac-6f23-74c8-bac5-000000000004',
  code: 'A1',
  name: 'Main Branch',
  isActive: true,
  timezone: null,
};

function setup(
  onJobPost: (
    headers: Record<string, string>,
    attempt: number,
  ) => { status: number; body?: unknown },
) {
  let jobPosts = 0;
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me') return json(200, STAFF);
    if (path.startsWith('/customers?'))
      return json(200, { items: [CUSTOMER], page: 1, pageSize: 10, total: 1 });
    if (path === `/customers/${CUSTOMER.id}/assets`) return json(200, [DEVICE]);
    if (path === '/branches') return json(200, [BRANCH]);
    if (path === '/jobs' && init.method === 'POST') {
      jobPosts += 1;
      return onJobPost(init.headers as Record<string, string>, jobPosts);
    }
    if (path.startsWith('/jobs/')) return json(200, { id: 'job-1', jobNumber: 'A1-2026-000001' });
    return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/jobs/new'] }));
  render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return { calls, router };
}

async function walkToReview() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Name, mobile number or customer code'), 'asha');
  await user.click(screen.getByRole('button', { name: 'Search' }));
  await user.click(await screen.findByRole('button', { name: 'Select' }));
  await user.click(await screen.findByRole('button', { name: 'Select' }));
  await user.type(
    await screen.findByLabelText("Complaint (customer's own words)"),
    'Screen flickers when opened',
  );
  await user.type(screen.getByLabelText('Accessories received (comma separated)'), 'Charger, Bag');
  await user.click(screen.getByRole('button', { name: 'Review' }));
  await screen.findByRole('heading', { name: 'Review and register' });
  return user;
}

describe('job intake wizard', () => {
  it('reuses the same Idempotency-Key when a failed submission is retried', async () => {
    const keys: string[] = [];
    const { router } = setup((headers, attempt) => {
      keys.push(headers['Idempotency-Key'] ?? '');
      return attempt === 1
        ? json(503, { error: { code: 'INTERNAL_ERROR', message: 'Temporarily unavailable' } })
        : json(201, { id: 'job-1', jobNumber: 'A1-2026-000001' });
    });
    const user = await walkToReview();
    const review = screen.getByRole('heading', { name: 'Review and register' }).closest('section');
    expect(within(review as HTMLElement).getByText('Charger, Bag')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Register job' }));
    expect(await screen.findByText('Temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Retrying is safe/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Register job' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs/job-1'));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it('sends the selected customer, device and parsed details', async () => {
    const { calls } = setup(() => json(201, { id: 'job-1', jobNumber: 'A1-2026-000001' }));
    const user = await walkToReview();
    await user.click(screen.getByRole('button', { name: 'Register job' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/jobs') && c.init.method === 'POST')).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith('/jobs') && c.init.method === 'POST');
    const raw = post?.init.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
    expect(body).toMatchObject({
      customerId: CUSTOMER.id,
      assetId: DEVICE.id,
      branchId: BRANCH.id,
      serviceMode: 'AT_SERVICE_CENTRE',
      complaint: 'Screen flickers when opened',
      accessoriesReceived: ['Charger', 'Bag'],
      acknowledgementMethod: 'SIGNED_PAPER',
    });
    expect((body['intakeChecklist'] as unknown[]).length).toBeGreaterThan(0);
  });
});
