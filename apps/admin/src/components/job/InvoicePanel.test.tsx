import type * as RouterExports from '@tanstack/react-router';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../../lib/auth';
import { ME, fakeClient, json } from '../../test/fake-api';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterExports>()),
  Link: ({ children }: { children: unknown }) => children,
}));

const { InvoicePanel } = await import('./InvoicePanel');

const TOKEN = {
  accessToken: 'a.b.c',
  tokenType: 'Bearer',
  expiresIn: 900,
  mustChangePassword: false,
  mfaEnrollmentRequired: false,
};
const JOB = { id: 'job-1', status: 'REPAIR_COMPLETED', version: 4 } as never;
const LINE = {
  id: 'l1',
  position: 1,
  lineType: 'PART',
  description: 'Keyboard',
  hsnSac: '8473',
  quantity: '1',
  unit: 'NOS',
  unitPrice: '2500.00',
  discount: '0.00',
  taxableValue: '2500.00',
  taxCategory: 'PARTS',
  gstRate: '18',
  cgstRate: '9',
  sgstRate: '9',
  igstRate: '0',
  cgstAmount: '225.00',
  sgstAmount: '225.00',
  igstAmount: '0.00',
  lineTotal: '2950.00',
  creditedQuantity: '0',
};
const BASE = {
  id: 'inv-1',
  jobId: 'job-1',
  jobNumber: 'A1-1',
  branchId: 'b',
  customerId: 'c',
  financialYear: null,
  invoiceDate: null,
  currency: 'INR',
  supplyType: 'INTRA_STATE',
  placeOfSupply: { code: '19', name: 'West Bengal' },
  reverseCharge: false,
  supplier: null,
  recipient: { name: 'Asha', gstin: null, address: '', stateCode: '19', stateName: 'West Bengal' },
  lines: [LINE],
  taxableTotal: '2500.00',
  cgstTotal: '225.00',
  sgstTotal: '225.00',
  igstTotal: '0.00',
  taxTotal: '450.00',
  roundOff: '0.00',
  total: '2950.00',
  creditedTotal: '0.00',
  paidTotal: '0.00',
  balance: '2950.00',
  paymentState: 'UNPAID',
  documentType: 'TAX_INVOICE',
  documentTypeReason: null,
  amountInWords: '',
  notes: null,
  rowVersion: 1,
  issuedAt: null,
  creditNotes: [],
  allocations: [],
};

function setup(invoice: object, permissions: string[]) {
  const { client, calls } = fakeClient((url, init) => {
    const path = url.split('/api/v1')[1] ?? '';
    if (path === '/auth/refresh') return json(200, TOKEN);
    if (path === '/me') return json(200, { ...ME, permissions });
    if (path === '/jobs/job-1/invoices') return json(200, [invoice]);
    if (init.method === 'POST' || init.method === 'PUT') return json(200, invoice);
    return json(404, {});
  });
  render(
    <AuthProvider client={client}>
      <InvoicePanel job={JOB} />
    </AuthProvider>,
  );
  return calls;
}

describe('InvoicePanel', () => {
  it('explains why a draft cannot be issued yet', async () => {
    setup(
      {
        ...BASE,
        status: 'DRAFT',
        invoiceNumber: null,
        blockers: ['The tax configuration has not been approved yet (settings → tax).'],
      },
      ['invoices.read', 'invoices.write', 'invoices.issue'],
    );
    expect(await screen.findByText(/has not been approved yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Issue tax invoice' })).toBeDisabled();
    expect(screen.getByText('₹2,950.00')).toBeInTheDocument();
  });

  it('issues after confirmation with an idempotency key', async () => {
    const calls = setup({ ...BASE, status: 'DRAFT', invoiceNumber: null, blockers: [] }, [
      'invoices.read',
      'invoices.write',
      'invoices.issue',
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Issue tax invoice' }));
    const dialog = screen.getByRole('dialog', { name: 'Issue this tax invoice?' });
    expect(within(dialog).getByText(/can never be edited/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/invoices/inv-1/issue'))).toBe(true),
    );
    const post = calls.find((c) => c.url.endsWith('/invoices/inv-1/issue'));
    expect((post?.init.headers as Record<string, string>)['Idempotency-Key']).toBeTruthy();
  });

  it('issues a credit note for selected quantities with a reason', async () => {
    const calls = setup(
      {
        ...BASE,
        status: 'ISSUED',
        invoiceNumber: 'MT/2627/1',
        invoiceDate: '2026-11-19',
        blockers: [],
      },
      ['invoices.read', 'credit_notes.issue'],
    );
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', { name: /Tax invoice MT\/2627\/1/ }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Credit note' }));
    const dialog = screen.getByRole('dialog');
    const qty = within(dialog).getByLabelText(/Keyboard \(up to 1 NOS\)/);
    await user.clear(qty);
    await user.type(qty, '1');
    await user.click(within(dialog).getByRole('button', { name: 'Issue credit note' }));
    expect(await within(dialog).findByText('Required')).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Reason'), 'Part returned');
    await user.click(within(dialog).getByRole('button', { name: 'Issue credit note' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/credit-notes'))).toBe(true));
    const raw = calls.find((c) => c.url.endsWith('/credit-notes'))?.init.body;
    expect(JSON.parse(typeof raw === 'string' ? raw : '{}')).toEqual({
      reason: 'Part returned',
      full: false,
      lines: [{ invoiceLineId: 'l1', quantity: '1' }],
    });
  });

  it('switches a draft to a Bill of Supply only with a reason', async () => {
    const calls = setup({ ...BASE, status: 'DRAFT', invoiceNumber: null, blockers: [] }, [
      'invoices.read',
      'invoices.write',
      'invoices.issue',
    ]);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('radio', { name: 'Bill of supply (no GST)' }));
    const save = screen.getByRole('button', { name: 'Save and recalculate' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Issue tax invoice' })).toBeDisabled();
    await user.type(
      screen.getByLabelText('Why no GST is charged (required, kept on record)'),
      'Exempt supply',
    );
    await user.click(save);
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    const raw = calls.find((c) => c.init.method === 'PUT')?.init.body;
    const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as {
      documentType: string;
      documentTypeReason: string;
    };
    expect(body).toMatchObject({
      documentType: 'BILL_OF_SUPPLY',
      documentTypeReason: 'Exempt supply',
    });
  });
});
