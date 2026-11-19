import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CustomerClient } from '../../lib/customer';
import { CustomerPortal } from './CustomerPortal';

const JOB = {
  id: 'job-1',
  jobNumber: 'A1-2026-000007',
  status: 'REQUEST_RECEIVED',
  statusLabel: 'Request received',
  serviceMode: 'AT_SERVICE_CENTRE',
  branch: { name: 'Main Branch' },
  device: { category: 'Printer', brand: 'Inkly', model: 'P200', serialNumber: null },
  complaint: 'Paper jams',
  submittedAt: '2026-11-18T10:00:00.000Z',
  updates: [],
  timeline: [
    {
      status: 'REQUEST_RECEIVED',
      label: 'Request received',
      message: null,
      at: '2026-11-18T10:00:00.000Z',
    },
  ],
};

const ESTIMATE = {
  id: 'est-1',
  version: 2,
  status: 'SENT',
  expired: false,
  currency: 'INR',
  subtotal: '1000.0000',
  discountTotal: '0.0000',
  total: '1000.0000',
  customerPayable: '1000.0000',
  covered: '0.0000',
  taxNote: 'GST extra as applicable.',
  validUntil: '2026-12-02',
  terms: 'Terms.',
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
  ],
  sentAt: '2026-11-18T10:00:00.000Z',
  decision: null,
  jobNumber: 'A1-2026-000007',
  businessName: 'Dev Org',
  device: 'Printer: Inkly P200',
};

const TOKENS = {
  accessToken: 'access-1',
  tokenType: 'Bearer',
  expiresIn: 900,
  refreshExpiresAt: '2026-12-19T00:00:00.000Z',
};

type Call = {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  credentials?: string;
};

function fake(handler: (path: string, method: string, body: unknown) => [number, unknown]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).replace('http://api.test/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    calls.push({
      path,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
      credentials: init?.credentials,
    });
    const [status, payload] = handler(path, method, body);
    return new Response(status === 204 ? null : JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { client: new CustomerClient('http://api.test', fetchImpl), calls };
}

const UNAUTH = [
  401,
  { error: { code: 'UNAUTHENTICATED', message: 'Session expired. Sign in again.' } },
] as [number, unknown];

describe('customer portal', () => {
  it('signs a new customer in with a WhatsApp code, asking for a name, and lists their jobs', async () => {
    let named = false;
    const { client, calls } = fake((path, _m, body) => {
      if (path === '/customer/auth/web/refresh') return UNAUTH;
      if (path === '/customer/auth/otp/request') return [200, { expiresIn: 300 }];
      if (path === '/customer/auth/web/verify') {
        if (!(body as { fullName?: string }).fullName)
          return [400, { error: { code: 'PROFILE_REQUIRED', message: 'Name required' } }];
        named = true;
        return [200, TOKENS];
      }
      if (path === '/customer/jobs') return [200, [JOB]];
      return [404, null];
    });
    render(<CustomerPortal client={client} />);
    fireEvent.change(await screen.findByLabelText('Mobile number'), {
      target: { value: '9812345678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    fireEvent.change(await screen.findByLabelText('6-digit code sent to you on WhatsApp'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    fireEvent.change(await screen.findByLabelText('Your name'), { target: { value: 'Asha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'My service requests' })).toBeInTheDocument();
    expect(named).toBe(true);
    expect(await screen.findByText('A1-2026-000007')).toBeInTheDocument();
    // Cookie session: credentials included, refresh token never in a body, CSRF header on refresh.
    expect(calls.every((c) => c.credentials === 'include')).toBe(true);
    expect(calls.find((c) => c.path === '/customer/auth/web/refresh')?.headers['x-icon-csrf']).toBe(
      '1',
    );
    expect(calls.find((c) => c.path === '/customer/jobs')?.headers['Authorization']).toBe(
      'Bearer access-1',
    );
  });

  it('shows a job with invoices and approves the estimate only after confirming', async () => {
    let decided: unknown = null;
    const { client } = fake((path, method, body) => {
      if (path === '/customer/auth/web/refresh') return [200, TOKENS];
      if (path === '/customer/jobs') return [200, [JOB]];
      if (path === '/customer/jobs/job-1') return [200, JOB];
      if (path === '/customer/jobs/job-1/estimates')
        return [200, [decided ? { ...ESTIMATE, status: 'APPROVED' } : ESTIMATE]];
      if (path === '/customer/invoices')
        return [
          200,
          [
            {
              id: 'inv-1',
              invoiceNumber: 'INV-2627-000001',
              invoiceDate: '2026-11-19',
              jobNumber: 'A1-2026-000007',
              currency: 'INR',
              total: '1180.00',
              creditedTotal: '0.00',
              balance: '1180.00',
              status: 'ISSUED',
              creditNotes: [],
            },
          ],
        ];
      if (path === '/customer/payments') return [200, []];
      if (path === '/customer/invoices/inv-1/pdf' && method === 'POST')
        return [
          200,
          {
            url: 'https://files.test/signed',
            documentNumber: 'INV-2627-000001',
            expiresAt: '2026-11-19T10:05:00.000Z',
          },
        ];
      if (path === '/customer/estimates/est-1/decision') {
        decided = body;
        return [200, { ...ESTIMATE, status: 'APPROVED' }];
      }
      return [404, null];
    });
    render(<CustomerPortal client={client} />);
    fireEvent.click(await screen.findByRole('button', { name: /A1-2026-000007/ }));
    expect(await screen.findByRole('heading', { name: 'Job A1-2026-000007' })).toBeInTheDocument();
    expect(screen.getByText(/due ₹1,180\.00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Invoice INV-2627-000001 (PDF)' }));
    expect(await screen.findByRole('link', { name: /Open INV-2627-000001/ })).toHaveAttribute(
      'href',
      'https://files.test/signed',
    );

    expect(screen.getByRole('button', { name: 'Approve estimate' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /accept the terms/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Approve estimate' }));
    expect(decided).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, approve' }));
    await waitFor(() => expect(decided).toEqual({ decision: 'APPROVED', termsAccepted: true }));
    expect(await screen.findByText('You approved this estimate.')).toBeInTheDocument();
  });

  it('retries once with a refreshed session when the access token has expired', async () => {
    let jobsCalls = 0;
    let refreshes = 0;
    const { client } = fake((path) => {
      if (path === '/customer/auth/web/refresh') {
        refreshes += 1;
        return [200, TOKENS];
      }
      if (path === '/customer/jobs') return ++jobsCalls === 1 ? UNAUTH : [200, []];
      return [404, null];
    });
    render(<CustomerPortal client={client} />);
    expect(await screen.findByText(/no service requests yet/)).toBeInTheDocument();
    expect(refreshes).toBe(2);
  });
});
