import { SETTINGS, financialYear } from '@icon/contracts';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockOtpProvider } from '../src/customer-auth/otp-provider.js';
import {
  type OrgFixture,
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  newKey,
  resetDatabase,
} from './integration/harness.js';

interface ErrorBody {
  error: { code: string; message: string };
}
interface InvoiceBody {
  id: string;
  status: string;
  invoiceNumber: string | null;
  supplyType: string;
  placeOfSupply: { code: string; name: string };
  lines: {
    id: string;
    description: string;
    hsnSac: string;
    gstRate: string;
    taxableValue: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
    quantity: string;
  }[];
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  roundOff: string;
  total: string;
  creditedTotal: string;
  paidTotal: string;
  balance: string;
  paymentState: string;
  documentType: string;
  documentTypeReason: string | null;
  amountInWords: string;
  blockers: string[];
  rowVersion: number;
  creditNotes: { id: string; number: string; total: string }[];
  allocations: { id: string; amount: string; releasedAt: string | null }[];
  recipient: { gstin: string | null; stateCode: string };
}

const MH_GSTIN = '27AABCU9603R1ZN';
const BUSINESS = {
  legalName: 'ICON INFOSYS',
  tradeName: null,
  gstin: '19AHDPB5074F1ZK',
  address: {
    line1: 'MIG-7, Nilganj Road',
    line2: 'Sodepur',
    city: 'Kolkata',
    stateCode: '19',
    postalCode: '700110',
  },
  phones: ['9830377112'],
  emails: ['info@iconinfosys.co.in'],
  website: null,
  signatoryName: null,
  signatoryDesignation: null,
};

describe('GST invoicing (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  const users: Record<string, string> = {};
  const tokens: Record<string, string> = {};
  const fyShort = financialYear(new Date(), 4, 'UTC').short;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1', 'A2']);
    for (const [key, roles, branches] of [
      ['reception', ['RECEPTION'], ['A1']],
      ['tech1', ['TECHNICIAN'], ['A1']],
      ['accounts', ['ACCOUNTS'], ['A1']],
      ['accountsA2', ['ACCOUNTS'], ['A2']],
      ['manager', ['BRANCH_ADMIN'], ['A1']],
      ['super', ['SUPER_ADMIN'], []],
    ] as const) {
      const user = await createUser(t.prisma, org, {
        email: `${key}@a.test`,
        roles: [...roles],
        branches: [...branches],
      });
      users[key] = user.id;
      tokens[key] = (await login(t, user.email)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (who: string) => bearer(tokens[who] ?? '');

  async function configure(approve = true) {
    await http()
      .put('/api/v1/settings/money')
      .set(as('super'))
      .send({ value: { currency: 'INR' }, reason: 'test' })
      .expect(200);
    await http()
      .put('/api/v1/settings/business')
      .set(as('super'))
      .send({ value: BUSINESS, reason: 'Business details' })
      .expect(200);
    if (approve) {
      await http()
        .put('/api/v1/settings/tax')
        .set(as('super'))
        .send({
          value: {
            ...SETTINGS.tax.default,
            status: 'APPROVED',
            approval: { approvedBy: 'Test accountant', approvedOn: '2026-11-19', note: null },
          },
          reason: 'Approved by accountant',
        })
        .expect(200);
    }
  }

  async function finishedJob(customer: Record<string, unknown> = {}) {
    const c = await http()
      .post('/api/v1/customers')
      .set(as('reception'))
      .send({
        type: 'INDIVIDUAL',
        name: 'Asha Rao',
        phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`,
        ...customer,
      });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const customerId = (c.body as { id: string }).id;
    const asset = await http()
      .post('/api/v1/assets')
      .set(as('reception'))
      .send({ customerId, categoryId: org.categories['LAPTOP'], brand: 'Acme', model: 'Book' })
      .expect(201);
    const job = await http()
      .post('/api/v1/jobs')
      .set(as('reception'))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches['A1'],
        customerId,
        assetId: (asset.body as { asset: { id: string } }).asset.id,
        serviceType: 'OUT_OF_WARRANTY',
        serviceMode: 'AT_SERVICE_CENTRE',
        complaint: 'Keys not working',
      });
    expect(job.status, JSON.stringify(job.body)).toBe(201);
    const jobId = (job.body as { id: string }).id;
    await http()
      .post(`/api/v1/jobs/${jobId}/assignments`)
      .set(as('manager'))
      .send({ technicianUserId: users['tech1'] })
      .expect(201);
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: { status: 'ESTIMATE_PREPARATION' },
    });
    const draft = await http()
      .post(`/api/v1/jobs/${jobId}/estimates`)
      .set(as('tech1'))
      .send({
        lines: [
          { lineType: 'PART', description: 'Keyboard', quantity: '1', unitPrice: '2500' },
          { lineType: 'LABOUR', description: 'Fitting', quantity: '1', unitPrice: '600' },
          {
            lineType: 'PART',
            description: 'Screws (warranty)',
            quantity: '4',
            unitPrice: '10',
            coverage: 'WARRANTY',
          },
        ],
      });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const sent = await http()
      .post(`/api/v1/estimates/${(draft.body as { id: string }).id}/send`)
      .set(as('manager'))
      .send({ rowVersion: (draft.body as { rowVersion: number }).rowVersion })
      .expect(200);
    await http()
      .post('/api/v1/public/estimate-links/decision')
      .send({
        token: (sent.body as { approvalLink: { token: string } }).approvalLink.token,
        decision: 'APPROVED',
        termsAccepted: true,
      })
      .expect(200);
    await t.prisma.serviceJob.update({
      where: { id: jobId },
      data: {
        status: 'REPAIR_COMPLETED',
        completedAt: new Date(),
        completedById: users['tech1'] ?? null,
        repairSummary: 'Done',
        qcChecklist: [{ item: 'ok', passed: true }],
      },
    });
    return { jobId, customerId };
  }

  const issue = (id: string, key = newKey(), who = 'accounts') =>
    http().post(`/api/v1/invoices/${id}/issue`).set(as(who)).set('Idempotency-Key', key);
  const pay = (job: { jobId: string; customerId: string }, amount: string) =>
    http()
      .post('/api/v1/payments')
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({
        branchId: org.branches['A1'],
        customerId: job.customerId,
        jobId: job.jobId,
        amount,
        method: 'CASH',
      })
      .expect(201);

  it('builds a draft from the approved estimate and refuses to issue until tax settings are approved', async () => {
    await configure(false);
    const job = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    expect(draft.status).toBe('DRAFT');
    expect(draft.lines.map((l) => [l.description, l.hsnSac, l.gstRate, l.taxableValue])).toEqual([
      ['Keyboard', '8473', '18', '2500.00'],
      ['Fitting', '998713', '18', '600.00'],
      ['Screws (warranty) (covered by warranty)', '8473', '18', '0.00'],
    ]); // warranty line listed at zero value (owner Q26)
    expect(draft.blockers).toEqual([
      'The tax configuration has not been approved yet (settings → tax).',
    ]);
    const blocked = await issue(draft.id).expect(409);
    expect((blocked.body as ErrorBody).error.code).toBe('TAX_CONFIG_NOT_APPROVED');
    // The same draft is returned when asked again.
    expect(
      (
        (await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201))
          .body as InvoiceBody
      ).id,
    ).toBe(draft.id);
    await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('reception')).expect(403);
  });

  it('issues an intra-state GST invoice once, with allocation, notification, PDF and frozen values', async () => {
    await configure();
    const job = await finishedJob();
    await pay(job, '1000');
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const key = newKey();
    const issued = (await issue(draft.id, key).expect(200)).body as InvoiceBody;
    expect(issued).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: `MT/${fyShort}/1`,
      supplyType: 'INTRA_STATE',
      placeOfSupply: { code: '19', name: 'West Bengal' },
      taxableTotal: '3100.00',
      cgstTotal: '279.00',
      sgstTotal: '279.00',
      igstTotal: '0.00',
      roundOff: '0.00',
      total: '3658.00',
      paidTotal: '1000.00',
      balance: '2658.00',
      paymentState: 'PARTLY_PAID',
      amountInWords: 'Three Thousand Six Hundred Fifty Eight Rupees Only',
    });
    expect(issued.lines[0]).toMatchObject({
      taxableValue: '2500.00',
      cgstAmount: '225.00',
      sgstAmount: '225.00',
      igstAmount: '0.00',
    });
    // Safe retry returns the same invoice; no second number.
    const replay = await issue(draft.id, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(await t.prisma.invoice.count({ where: { invoiceNumber: { not: null } } })).toBe(1);
    await issue(draft.id).expect(409);

    // Later payment settles it automatically.
    await pay(job, '2658');
    const paid = (await http().get(`/api/v1/invoices/${draft.id}`).set(as('accounts')).expect(200))
      .body as InvoiceBody;
    expect(paid).toMatchObject({ paymentState: 'PAID', balance: '0.00', paidTotal: '3658.00' });

    expect(
      await t.prisma.notificationOutbox.count({ where: { eventType: 'INVOICE_ISSUED' } }),
    ).toBe(1);
    expect(await t.prisma.invoiceTaxSummary.count({ where: { invoiceId: draft.id } })).toBe(2);
    expect(
      await t.prisma.auditLog.count({ where: { action: 'invoice.issued', entityId: draft.id } }),
    ).toBe(1);
    const pdf = (
      await http().post(`/api/v1/invoices/${draft.id}/pdf`).set(as('accounts')).expect(201)
    ).body as { url: string; documentId: string };
    expect(
      Buffer.from(await (await fetch(pdf.url)).arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    const again = (
      await http().post(`/api/v1/invoices/${draft.id}/pdf`).set(as('accounts')).expect(201)
    ).body as { documentId: string };
    expect(again.documentId).toBe(pdf.documentId);

    // The database refuses edits and deletion of an issued invoice.
    await expect(
      t.prisma.invoice.update({ where: { id: draft.id }, data: { total: '1.00' } }),
    ).rejects.toThrow(/cannot change/);
    await expect(t.prisma.invoice.delete({ where: { id: draft.id } })).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      t.prisma.invoiceLine.updateMany({ where: { invoiceId: draft.id }, data: { unitPrice: '1' } }),
    ).rejects.toThrow(/cannot change/);
    await http()
      .put(`/api/v1/invoices/${draft.id}`)
      .set(as('accounts'))
      .send({
        rowVersion: 99,
        lines: [{ lineType: 'OTHER', description: 'x', quantity: '1', unitPrice: '1' }],
      })
      .expect(409);

    // Delivery balance and outstanding now use the invoice.
    const deliveries = (
      await http().get(`/api/v1/jobs/${job.jobId}/deliveries`).set(as('accounts')).expect(200)
    ).body as { balance: object };
    expect(deliveries.balance).toMatchObject({
      basis: 'INVOICE',
      billed: '3658.0000',
      due: '0.0000',
    });
  });

  it('charges IGST to a registered customer in another state', async () => {
    await configure();
    const job = await finishedJob({
      type: 'BUSINESS',
      name: 'Mumbai Traders',
      taxIdentifier: MH_GSTIN,
      billingAddress: {
        line1: '1 Marine Drive',
        city: 'Mumbai',
        region: 'Maharashtra',
        countryCode: 'IN',
      },
    });
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const issued = (await issue(draft.id).expect(200)).body as InvoiceBody;
    expect(issued).toMatchObject({
      supplyType: 'INTER_STATE',
      placeOfSupply: { code: '27', name: 'Maharashtra' },
      cgstTotal: '0.00',
      sgstTotal: '0.00',
      igstTotal: '558.00',
      total: '3658.00',
    });
    expect(issued.recipient).toMatchObject({ gstin: MH_GSTIN, stateCode: '27' });
    const summary = (
      await http()
        .get('/api/v1/reports/gst-summary?from=2000-01-01&to=2100-01-01')
        .set(as('accounts'))
        .expect(200)
    ).body as {
      net: object;
      bySegment: { segment: string }[];
      byHsn: object[];
    };
    expect(summary.net).toMatchObject({ taxable: '3100.00', igst: '558.00', cgst: '0.00' });
    expect(summary.bySegment).toEqual([
      { segment: 'B2B', count: 1, taxable: '3100.00', tax: '558.00' },
    ]);
    expect(summary.byHsn).toEqual([
      {
        hsnSac: '8473',
        gstRate: '18',
        quantity: '5', // keyboard + 4 warranty screws at zero value
        taxable: '2500.00',
        cgst: '0.00',
        sgst: '0.00',
        igst: '450.00',
      },
      {
        hsnSac: '998713',
        gstRate: '18',
        quantity: '1',
        taxable: '600.00',
        cgst: '0.00',
        sgst: '0.00',
        igst: '108.00',
      },
    ]);
  });

  it('corrects with credit notes, frees over-allocated money for refund, and cancels on full credit', async () => {
    await configure();
    const job = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    await issue(draft.id).expect(200);
    const payment = (await pay(job, '3658')).body as { id: string };
    const labour = draft.lines.find((l) => l.description === 'Fitting');
    const partial = (
      await http()
        .post(`/api/v1/invoices/${draft.id}/credit-notes`)
        .set(as('accounts'))
        .set('Idempotency-Key', newKey())
        .send({
          reason: 'Fitting charge waived',
          lines: [{ invoiceLineId: labour?.id, quantity: '1' }],
        })
        .expect(201)
    ).body as InvoiceBody;
    // 600 + 54 + 54 = 708 credited; payment allocation trimmed to the new open amount.
    expect(partial).toMatchObject({
      status: 'ISSUED',
      creditedTotal: '708.00',
      paidTotal: '2950.00',
      balance: '0.00',
      paymentState: 'PAID',
    });
    expect(partial.creditNotes).toEqual([
      expect.objectContaining({ number: `CN/${fyShort}/1`, total: '708.00' }),
    ]);
    // The freed 708 is refundable.
    await http()
      .post(`/api/v1/payments/${payment.id}/refunds`)
      .set(as('manager'))
      .set('Idempotency-Key', newKey())
      .send({ amount: '708', method: 'CASH', reason: 'Credit note refund' })
      .expect(201);
    await http()
      .post(`/api/v1/invoices/${draft.id}/credit-notes`)
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({ reason: 'Too much', lines: [{ invoiceLineId: labour?.id, quantity: '1' }] })
      .expect(400);
    const full = (
      await http()
        .post(`/api/v1/invoices/${draft.id}/credit-notes`)
        .set(as('accounts'))
        .set('Idempotency-Key', newKey())
        .send({ reason: 'Customer returned the part', full: true })
        .expect(201)
    ).body as InvoiceBody;
    expect(full).toMatchObject({
      status: 'CANCELLED',
      creditedTotal: '3658.00',
      paidTotal: '0.00',
      paymentState: 'CREDITED',
    });
    const cn = full.creditNotes[1];
    expect(cn).toMatchObject({ total: '2950.00' });
    const pdf = (
      await http()
        .post(`/api/v1/credit-notes/${cn?.id ?? ''}/pdf`)
        .set(as('accounts'))
        .expect(201)
    ).body as { url: string };
    expect(
      Buffer.from(await (await fetch(pdf.url)).arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    await expect(t.prisma.creditNote.deleteMany()).rejects.toThrow(/append-only/);
    const summary = (
      await http()
        .get('/api/v1/reports/gst-summary?from=2000-01-01&to=2100-01-01')
        .set(as('accounts'))
        .expect(200)
    ).body as { net: object; creditNotes: object };
    expect(summary.net).toMatchObject({
      taxable: '0.00',
      cgst: '0.00',
      sgst: '0.00',
      total: '0.00',
    });
    expect(summary.creditNotes).toMatchObject({ count: 2, total: '3658.00' });
  });

  it('keeps invoices in their branch and lets customers see only their own', async () => {
    await configure();
    const job = await finishedJob({ phone: '+919812345678' });
    const other = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    await issue(draft.id).expect(200);
    const otherDraft = (
      await http().post(`/api/v1/jobs/${other.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const second = (await issue(otherDraft.id).expect(200)).body as InvoiceBody;
    expect(second.invoiceNumber).toBe(`MT/${fyShort}/2`);
    await http().get(`/api/v1/invoices/${draft.id}`).set(as('accountsA2')).expect(404);
    expect(
      (
        (await http().get('/api/v1/invoices').set(as('accountsA2')).expect(200)).body as {
          total: number;
        }
      ).total,
    ).toBe(0);
    expect(
      (
        (await http().get('/api/v1/invoices').set(as('accounts')).expect(200)).body as {
          total: number;
        }
      ).total,
    ).toBe(2);

    await http()
      .post('/api/v1/customer/auth/otp/request')
      .send({ organizationCode: 'ORGA', phone: '+919812345678' })
      .expect(200);
    const code = t.app.get(MockOtpProvider).sent.get('+919812345678') ?? '';
    const customerToken = (
      (
        await http()
          .post('/api/v1/customer/auth/otp/verify')
          .send({ organizationCode: 'ORGA', phone: '+919812345678', code })
          .expect(200)
      ).body as { accessToken: string }
    ).accessToken;
    const mine = (
      await http().get('/api/v1/customer/invoices').set(bearer(customerToken)).expect(200)
    ).body as { id: string }[];
    expect(mine.map((i) => i.id)).toEqual([draft.id]);
    await http()
      .post(`/api/v1/customer/invoices/${draft.id}/pdf`)
      .set(bearer(customerToken))
      .expect(201);
    await http()
      .post(`/api/v1/customer/invoices/${otherDraft.id}/pdf`)
      .set(bearer(customerToken))
      .expect(404);
  });

  it('edits and deletes drafts with version checks', async () => {
    await configure();
    const job = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const edited = (
      await http()
        .put(`/api/v1/invoices/${draft.id}`)
        .set(as('accounts'))
        .send({
          rowVersion: draft.rowVersion,
          lines: [
            {
              lineType: 'SERVICE_FEE',
              description: 'Diagnosis',
              quantity: '1',
              unitPrice: '299.99',
              discount: '0',
            },
          ],
        })
        .expect(200)
    ).body as InvoiceBody;
    // 299.99 + 27.00 + 27.00 = 353.99 → 354.00 (round-off 0.01)
    expect(edited).toMatchObject({
      taxableTotal: '299.99',
      cgstTotal: '27.00',
      total: '354.00',
      roundOff: '0.01',
    });
    const stale = await http()
      .put(`/api/v1/invoices/${draft.id}`)
      .set(as('accounts'))
      .send({
        rowVersion: draft.rowVersion,
        lines: [{ lineType: 'OTHER', description: 'x', quantity: '1', unitPrice: '1' }],
      })
      .expect(409);
    expect((stale.body as ErrorBody).error.code).toBe('VERSION_CONFLICT');
    await http().delete(`/api/v1/invoices/${draft.id}`).set(as('accounts')).expect(204);
    expect(await t.prisma.invoice.count()).toBe(0);
  });

  it('issues a Bill of Supply (no GST) in its own series, with a reason, kept out of GST figures', async () => {
    await configure();
    const job = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const lines = draft.lines.map((l) => ({
      lineType: 'PART',
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.taxableValue,
    }));
    const noReason = await http()
      .put(`/api/v1/invoices/${draft.id}`)
      .set(as('accounts'))
      .send({ rowVersion: draft.rowVersion, lines, documentType: 'BILL_OF_SUPPLY' })
      .expect(400);
    expect((noReason.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    const bos = (
      await http()
        .put(`/api/v1/invoices/${draft.id}`)
        .set(as('accounts'))
        .send({
          rowVersion: draft.rowVersion,
          lines,
          documentType: 'BILL_OF_SUPPLY',
          documentTypeReason: 'Exempt supply as advised by the accountant',
        })
        .expect(200)
    ).body as InvoiceBody;
    expect(bos).toMatchObject({
      documentType: 'BILL_OF_SUPPLY',
      documentTypeReason: 'Exempt supply as advised by the accountant',
      taxableTotal: '3100.00',
      cgstTotal: '0.00',
      sgstTotal: '0.00',
      igstTotal: '0.00',
      total: '3100.00',
    });
    expect(bos.lines.every((l) => l.gstRate === '0')).toBe(true);
    expect(bos.lines[0]?.hsnSac).toBe('8473');
    expect(
      await t.prisma.auditLog.count({
        where: {
          action: 'invoice.draft_updated',
          entityId: draft.id,
          reason: 'Exempt supply as advised by the accountant',
        },
      }),
    ).toBe(1);
    // The database itself refuses a Bill of Supply that carries tax.
    await expect(
      t.prisma
        .$executeRaw`UPDATE invoices SET cgst_total = 1, sgst_total = 1, tax_total = 2, total = total + 2 WHERE id = ${draft.id}::uuid`,
    ).rejects.toThrow(/invoices_bill_of_supply_no_tax/);

    const issued = (await issue(draft.id).expect(200)).body as InvoiceBody;
    expect(issued).toMatchObject({
      invoiceNumber: `BS/${fyShort}/1`,
      documentType: 'BILL_OF_SUPPLY',
      total: '3100.00',
    });
    await expect(
      t.prisma.invoice.update({ where: { id: draft.id }, data: { documentType: 'TAX_INVOICE' } }),
    ).rejects.toThrow(/cannot change/);
    await http().post(`/api/v1/invoices/${draft.id}/pdf`).set(as('accounts')).expect(201);
    expect(
      await t.prisma.document.count({
        where: { entityId: draft.id, documentType: 'BILL_OF_SUPPLY' },
      }),
    ).toBe(1);

    // A tax invoice keeps its own series.
    const other = await finishedJob();
    const taxDraft = (
      await http().post(`/api/v1/jobs/${other.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    expect(((await issue(taxDraft.id).expect(200)).body as InvoiceBody).invoiceNumber).toBe(
      `MT/${fyShort}/1`,
    );

    const summary = (
      await http()
        .get('/api/v1/reports/gst-summary?from=2000-01-01&to=2100-01-01')
        .set(as('accounts'))
        .expect(200)
    ).body as {
      invoices: { count: number; taxable: string; total: string };
      billsOfSupply: { count: number; total: string; credited: string };
      byRate: { gstRate: string }[];
    };
    expect(summary.invoices).toMatchObject({ count: 1, taxable: '3100.00', total: '3658.00' });
    expect(summary.billsOfSupply).toEqual({ count: 1, total: '3100.00', credited: '0.00' });
    expect(summary.byRate.map((r) => r.gstRate)).toEqual(['18']);

    // Credit note against a Bill of Supply carries no tax and is reported with it.
    await http()
      .post(`/api/v1/invoices/${draft.id}/credit-notes`)
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({ reason: 'Returned', full: true })
      .expect(201);
    const after = (
      await http()
        .get('/api/v1/reports/gst-summary?from=2000-01-01&to=2100-01-01')
        .set(as('accounts'))
        .expect(200)
    ).body as typeof summary & { creditNotes: { count: number } };
    expect(after.creditNotes.count).toBe(0);
    expect(after.billsOfSupply.credited).toBe('3100.00');
  });

  it('issues a zero-value invoice for a warranty job and cancels it only as a whole', async () => {
    await configure();
    const job = await finishedJob();
    const draft = (
      await http().post(`/api/v1/jobs/${job.jobId}/invoices`).set(as('accounts')).expect(201)
    ).body as InvoiceBody;
    const zero = (
      await http()
        .put(`/api/v1/invoices/${draft.id}`)
        .set(as('accounts'))
        .send({
          rowVersion: draft.rowVersion,
          lines: [
            {
              lineType: 'PART',
              description: 'Keyboard (covered by warranty)',
              quantity: '2',
              unitPrice: '0',
            },
          ],
        })
        .expect(200)
    ).body as InvoiceBody;
    const issued = (await issue(zero.id).expect(200)).body as InvoiceBody;
    expect(issued).toMatchObject({
      status: 'ISSUED',
      invoiceNumber: `MT/${fyShort}/1`,
      total: '0.00',
      balance: '0.00',
      paymentState: 'PAID',
      amountInWords: expect.stringMatching(/zero/i) as unknown,
    });
    const line = issued.lines[0];
    const partial = await http()
      .post(`/api/v1/invoices/${zero.id}/credit-notes`)
      .set(as('accounts'))
      .set('Idempotency-Key', newKey())
      .send({ reason: 'One returned', lines: [{ invoiceLineId: line?.id, quantity: '1' }] })
      .expect(409);
    expect((partial.body as ErrorBody).error.code).toBe('CREDIT_EXCEEDS_INVOICE');
    const cancelled = (
      await http()
        .post(`/api/v1/invoices/${zero.id}/credit-notes`)
        .set(as('accounts'))
        .set('Idempotency-Key', newKey())
        .send({ reason: 'Issued to the wrong customer', full: true })
        .expect(201)
    ).body as InvoiceBody;
    expect(cancelled).toMatchObject({ status: 'CANCELLED', paymentState: 'CREDITED' });
    expect(cancelled.creditNotes).toEqual([
      expect.objectContaining({ number: `CN/${fyShort}/1`, total: '0.00' }),
    ]);
  });
});
