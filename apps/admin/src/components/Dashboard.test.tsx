import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../lib/api-client';
import { AuthProvider } from '../lib/auth';
import { ME, fakeClient, json } from '../test/fake-api';
import { ExportButtons } from './ExportButtons';

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
};

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => children,
}));

const { Dashboard } = await import('./Dashboard');

const DASHBOARD = {
  generatedAt: '2026-11-19T10:00:00.000Z',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  newJobsToday: 4,
  jobsByStatus: [{ status: 'DIAGNOSIS', count: 3 }],
  overdueJobs: 2,
  awaitingApproval: 1,
  waitingForParts: 0,
  repairCompleted: 1,
  readyForDelivery: 5,
  collectedToday: '900.0000',
  collectedThisMonth: '12500.5000',
  outstanding: { total: '1400.0000', jobs: 1 },
  technicianWorkload: [{ user: { id: 'u1', fullName: 'Tara Tech' }, openJobs: 3 }],
  warrantyMix: [{ serviceType: 'IN_WARRANTY', count: 2 }],
};

afterEach(() => vi.unstubAllGlobals());

describe('Dashboard', () => {
  it('shows the widgets with labels and formatted money', async () => {
    const { client } = fakeClient((url) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, TOKEN);
      if (path === '/me') return json(200, { ...ME, permissions: ['reports.read'] });
      if (path === '/reports/dashboard') return json(200, DASHBOARD);
      return json(404, {});
    });
    render(
      <AuthProvider client={client}>
        <Dashboard />
      </AuthProvider>,
    );
    expect(await screen.findByText('New jobs today')).toBeInTheDocument();
    expect(screen.getByText('Overdue jobs').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Ready for delivery').nextSibling).toHaveTextContent('5');
    expect(screen.getByText('Collected this month').nextSibling).toHaveTextContent(/12,500\.5/);
    expect(screen.getByText(/1 job\(s\) · interim/)).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Tara Tech' })).toBeInTheDocument();
    expect(screen.getByText('In warranty: 2')).toBeInTheDocument();
    expect(screen.getByText(/Times use Asia\/Kolkata/)).toBeInTheDocument();
  });
});

describe('ExportButtons', () => {
  it('downloads the export with the current filters', async () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicks: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download);
    });
    const requested: string[] = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(url);
      if (url.endsWith('/auth/refresh'))
        return Promise.resolve(new Response(JSON.stringify(TOKEN), { status: 200 }));
      if (url.endsWith('/me'))
        return Promise.resolve(
          new Response(JSON.stringify({ ...ME, permissions: ['reports.read', 'reports.export'] }), {
            status: 200,
          }),
        );
      return Promise.resolve(
        new Response('﻿Job\r\n', {
          status: 200,
          headers: {
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="jobs-2026-11-19.csv"',
          },
        }),
      );
    });
    const client = new ApiClient('http://api.test', fetchImpl);
    render(
      <AuthProvider client={client}>
        <ExportButtons
          report="jobs"
          query={{
            from: '2026-11-01T00:00:00.000Z',
            to: '2026-11-20T00:00:00.000Z',
            branchId: undefined,
          }}
        />
      </AuthProvider>,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(clicks).toEqual(['jobs-2026-11-19.csv']));
    const exportUrl = new URL(requested.find((u) => u.includes('/export')) ?? '');
    expect(exportUrl.pathname).toBe('/api/v1/reports/jobs/export');
    expect(Object.fromEntries(exportUrl.searchParams)).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-20T00:00:00.000Z',
      format: 'csv',
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('is hidden without the export permission', async () => {
    const { client } = fakeClient((url) => {
      const path = url.split('/api/v1')[1] ?? '';
      if (path === '/auth/refresh') return json(200, TOKEN);
      if (path === '/me') return json(200, { ...ME, permissions: ['reports.read'] });
      return json(404, {});
    });
    const { container } = render(
      <AuthProvider client={client}>
        <ExportButtons report="jobs" query={{}} />
      </AuthProvider>,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull();
  });
});
