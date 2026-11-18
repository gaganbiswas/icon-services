import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { render, screen, waitFor } from '@testing-library/react';
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
const JOB = {
  id: 'job-1',
  jobNumber: 'A1-2026-000001',
  status: 'DIAGNOSIS',
  customerStatus: 'IN_DIAGNOSIS',
  serviceType: 'OUT_OF_WARRANTY',
  serviceMode: 'AT_SERVICE_CENTRE',
  branch: { id: 'b', code: 'A1', name: 'Main' },
  customer: { id: 'c', customerCode: 'C000001', name: 'Asha', phone: '+91 98123 45678' },
  asset: { id: 'a', category: 'Laptop', brand: 'Acme', model: 'Book', serialNumber: null },
  receivedAt: '2026-11-18T10:00:00.000Z',
  createdAt: '2026-11-18T10:00:00.000Z',
  complaint: 'Keyboard dead',
  intakeChecklist: [],
  accessoriesReceived: [],
  conditionNotes: null,
  serviceAddress: null,
  channel: 'STAFF',
  expectedCompletionDate: null,
  warrantyVerification: 'NOT_CHECKED',
  acknowledgementMethod: null,
  attachments: [],
  statusHistory: [],
  version: 4,
};
const WORKSPACE = {
  assignments: [],
  diagnoses: [],
  workLogs: [],
  completion: null,
  allowedTransitions: [
    { to: 'ESTIMATE_PREPARATION', reasonRequired: false },
    { to: 'ON_HOLD', reasonRequired: true },
  ],
  canWork: true,
  canSeeInternalNotes: true,
};
const NOTIFICATIONS = {
  items: [
    {
      id: 'n1',
      eventType: 'JOB_STATUS_CHANGED',
      jobId: 'job-1',
      status: 'COMPLETED',
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
      createdAt: '2026-11-18T10:00:00.000Z',
      deliveries: [
        {
          channel: 'WHATSAPP',
          provider: 'mock',
          status: 'ACCEPTED',
          providerMessageId: 'm',
          errorCode: null,
          createdAt: '2026-11-18T10:00:01.000Z',
        },
      ],
    },
  ],
  page: 1,
  pageSize: 50,
  total: 1,
};

function setup(workspace = WORKSPACE) {
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me')
      return json(200, {
        ...ME,
        permissions: ['jobs.read', 'jobs.transition', 'worklogs.write', 'notifications.read'],
      });
    if (path === '/jobs/job-1/workspace') return json(200, workspace);
    if (path.startsWith('/notifications')) return json(200, NOTIFICATIONS);
    if (path === '/jobs/job-1/status-transitions' && init.method === 'POST')
      return json(200, { ...JOB, status: 'ON_HOLD', version: 5 });
    if (path === '/jobs/job-1') return json(200, JOB);
    return json(404, { error: { code: 'NOT_FOUND', message: 'x' } });
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: ['/jobs/job-1'] }));
  render(
    <AuthProvider client={client}>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  return calls;
}

describe('job detail workspace', () => {
  it('offers only server-allowed transitions and requires a reason where needed', async () => {
    const calls = setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Work' }));
    const select = await screen.findByLabelText('New status');
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual(['Choose…', 'Estimate preparation', 'On hold (reason required)']);

    await user.selectOptions(select, 'ON_HOLD');
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    expect(await screen.findByText('A reason is required for this change')).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/status-transitions'))).toBe(false);

    await user.type(screen.getByLabelText('Reason (required, staff only)'), 'Waiting for customer');
    await user.click(screen.getByRole('button', { name: 'Change status' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/status-transitions'))).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith('/status-transitions'));
    const raw = post?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      to: 'ON_HOLD',
      version: 4,
      reason: 'Waiting for customer',
    });
  });

  it('explains when the job is not assigned to the user', async () => {
    setup({ ...WORKSPACE, canWork: false, allowedTransitions: [] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Work' }));
    expect(await screen.findByText(/not assigned to you/)).toBeInTheDocument();
    expect(screen.queryByLabelText('New status')).toBeNull();
  });

  it('never presents provider acceptance as delivery', async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Notifications' }));
    expect(
      await screen.findByText(/accepted by provider \(not yet confirmed delivered\)/),
    ).toBeInTheDocument();
  });
});
