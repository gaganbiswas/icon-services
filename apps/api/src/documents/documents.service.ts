import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_STATUS_BY_JOB_STATUS,
  CUSTOMER_STATUS_LABELS,
  type ChecklistItem,
  type DocumentLink,
  PAYMENT_METHOD_LABELS,
  SETTINGS,
  amountInWordsINR,
  formatMoney,
  stateName,
  summarizeByHsn,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { FilesService } from '../files/files.service.js';
import { SERVICE_MODE_LABELS, SERVICE_TYPE_LABELS, formatDateTime } from '../jobs/labels.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  type JobReceiptSnapshot,
  type ReceiptLayout,
  renderJobReceiptHtml,
} from './job-receipt.template.js';
import {
  type DeliveryChallanSnapshot,
  renderDeliveryChallanHtml,
} from './delivery-challan.template.js';
import {
  type PaymentReceiptSnapshot,
  renderPaymentReceiptHtml,
} from './payment-receipt.template.js';
import { PdfRenderer } from './pdf-renderer.service.js';
import { type TaxDocSnapshot, renderTaxDocumentHtml } from './tax-invoice.template.js';

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly renderer: PdfRenderer,
    private readonly audit: AuditService,
  ) {}

  /**
   * Returns the job receipt for a job the caller is already authorized to see.
   * The first request renders and stores it; later requests reuse the stored
   * PDF so reprints never change (CLAUDE.md §4.11).
   */
  async jobReceipt(
    organizationId: string,
    jobId: string,
    layout: ReceiptLayout,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const existing = await this.prisma.document.findFirst({
      where: {
        organizationId,
        entityType: 'service_job',
        entityId: jobId,
        documentType: 'JOB_RECEIPT',
        layout,
      },
      orderBy: { version: 'desc' },
      select: { id: true, documentNumber: true, version: true, fileId: true },
    });
    if (existing) {
      return this.link(organizationId, existing);
    }

    const snapshot = await this.buildSnapshot(organizationId, jobId);
    const pdf = await this.renderer.render(renderJobReceiptHtml(snapshot, layout));

    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const fileId = await this.files.storeGenerated(
          organizationId,
          pdf,
          `job-receipt-${snapshot.job.number}${layout === 'THERMAL_80' ? '-80mm' : ''}.pdf`,
          'application/pdf',
          tx,
        );
        const job = await tx.serviceJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { branchId: true },
        });
        const created = await tx.document.create({
          data: {
            organizationId,
            branchId: job.branchId,
            documentType: 'JOB_RECEIPT',
            entityType: 'service_job',
            entityId: jobId,
            documentNumber: snapshot.job.number,
            layout,
            version: 1,
            fileId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            generatedById: actor.userId,
          },
          select: { id: true, documentNumber: true, version: true, fileId: true },
        });
        await this.audit.record(tx, {
          organizationId,
          branchId: job.branchId,
          actorUserId: actor.userId,
          actorType: actor.userId ? 'USER' : 'SYSTEM',
          action: 'document.generated',
          entityType: 'document',
          entityId: created.id,
          after: { documentType: 'JOB_RECEIPT', jobId, layout, version: 1 },
        });
        return created;
      });
      return await this.link(organizationId, document);
    } catch (error) {
      // A concurrent request stored version 1 first (unique key); reuse it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.jobReceipt(organizationId, jobId, layout, actor);
      }
      throw error;
    }
  }

  /**
   * Payment receipt (ADR 0016). A new version is generated when the payment's
   * status changed since the last one (e.g. reversed), so reprints never hide a reversal.
   */
  async paymentReceipt(
    organizationId: string,
    paymentId: string,
    layout: ReceiptLayout,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organizationId },
    });
    if (!payment) throw AppException.notFound('Payment');
    const latest = await this.prisma.document.findFirst({
      where: {
        organizationId,
        entityType: 'payment',
        entityId: paymentId,
        documentType: 'PAYMENT_RECEIPT',
        layout,
      },
      orderBy: { version: 'desc' },
      select: { id: true, documentNumber: true, version: true, fileId: true, snapshot: true },
    });
    const latestStatus = (latest?.snapshot as { status?: string } | undefined)?.status;
    if (latest && latestStatus === payment.status) return this.link(organizationId, latest);

    const snapshot = await this.buildPaymentSnapshot(organizationId, paymentId);
    const pdf = await this.renderer.render(renderPaymentReceiptHtml(snapshot, layout));
    const version = (latest?.version ?? 0) + 1;
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const fileId = await this.files.storeGenerated(
          organizationId,
          pdf,
          `payment-receipt-${snapshot.receiptNumber}.pdf`,
          'application/pdf',
          tx,
        );
        const created = await tx.document.create({
          data: {
            organizationId,
            branchId: payment.branchId,
            documentType: 'PAYMENT_RECEIPT',
            entityType: 'payment',
            entityId: paymentId,
            documentNumber: snapshot.receiptNumber,
            layout,
            version,
            fileId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            generatedById: actor.userId,
          },
          select: { id: true, documentNumber: true, version: true, fileId: true },
        });
        await this.audit.record(tx, {
          organizationId,
          branchId: payment.branchId,
          actorUserId: actor.userId,
          actorType: actor.userId ? 'USER' : 'SYSTEM',
          action: 'document.generated',
          entityType: 'document',
          entityId: created.id,
          after: { documentType: 'PAYMENT_RECEIPT', paymentId, layout, version },
        });
        return created;
      });
      return await this.link(organizationId, document);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.paymentReceipt(organizationId, paymentId, layout, actor);
      }
      throw error;
    }
  }

  private async buildPaymentSnapshot(
    organizationId: string,
    paymentId: string,
  ): Promise<PaymentReceiptSnapshot> {
    const payment = await this.prisma.payment.findFirstOrThrow({
      where: { id: paymentId, organizationId },
    });
    const [organization, branch, customer, job, documents, payments] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { displayName: true, timezone: true },
      }),
      this.prisma.branch.findUniqueOrThrow({
        where: { id: payment.branchId },
        select: { name: true, timezone: true },
      }),
      this.prisma.customer.findUniqueOrThrow({
        where: { id: payment.customerId },
        select: { name: true, customerCode: true },
      }),
      payment.jobId
        ? this.prisma.serviceJob.findUnique({
            where: { id: payment.jobId },
            select: { jobNumber: true },
          })
        : Promise.resolve(null),
      this.settings.get(organizationId, 'documents'),
      this.settings.get(organizationId, 'payments'),
    ]);
    const timeZone = branch.timezone ?? organization.timezone ?? 'UTC';
    return {
      business: {
        name: organization.displayName,
        header: documents.businessHeader,
        branchName: branch.name,
      },
      receiptNumber: payment.receiptNumber,
      receivedAt: formatDateTime(payment.receivedAt, timeZone),
      timeZone,
      customer: { name: customer.name, code: customer.customerCode },
      jobNumber: job?.jobNumber ?? null,
      amount: formatMoney(payment.amount.toFixed(4), payment.currency),
      method: PAYMENT_METHOD_LABELS[payment.method],
      reference: payment.reference,
      status: payment.status,
      reversalReason: payment.reversalReason,
      footer: payments.receiptFooter,
      // The default is now no footer (owner Q27a); any text entered is the business's own.
      footerIsPlaceholder: false,
      generatedAt: `${formatDateTime(new Date(), timeZone)} (${timeZone})`,
    };
  }

  /** Delivery challan (ADR 0017); a new version is generated whenever the delivery status changes. */
  async deliveryChallan(
    organizationId: string,
    deliveryId: string,
    layout: ReceiptLayout,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id: deliveryId, organizationId },
    });
    if (!delivery) throw AppException.notFound('Delivery');
    const latest = await this.prisma.document.findFirst({
      where: {
        organizationId,
        entityType: 'delivery',
        entityId: deliveryId,
        documentType: 'DELIVERY_CHALLAN',
        layout,
      },
      orderBy: { version: 'desc' },
      select: { id: true, documentNumber: true, version: true, fileId: true, snapshot: true },
    });
    if (
      latest &&
      (latest.snapshot as { status?: string } | undefined)?.status === delivery.status
    ) {
      return this.link(organizationId, latest);
    }
    const snapshot = await this.buildChallanSnapshot(organizationId, deliveryId);
    const pdf = await this.renderer.render(renderDeliveryChallanHtml(snapshot, layout));
    const version = (latest?.version ?? 0) + 1;
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const fileId = await this.files.storeGenerated(
          organizationId,
          pdf,
          `delivery-challan-${snapshot.challanNumber}.pdf`,
          'application/pdf',
          tx,
        );
        const created = await tx.document.create({
          data: {
            organizationId,
            branchId: delivery.branchId,
            documentType: 'DELIVERY_CHALLAN',
            entityType: 'delivery',
            entityId: deliveryId,
            documentNumber: snapshot.challanNumber,
            layout,
            version,
            fileId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            generatedById: actor.userId,
          },
          select: { id: true, documentNumber: true, version: true, fileId: true },
        });
        await this.audit.record(tx, {
          organizationId,
          branchId: delivery.branchId,
          actorUserId: actor.userId,
          actorType: actor.userId ? 'USER' : 'SYSTEM',
          action: 'document.generated',
          entityType: 'document',
          entityId: created.id,
          after: { documentType: 'DELIVERY_CHALLAN', deliveryId, layout, version },
        });
        return created;
      });
      return await this.link(organizationId, document);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.deliveryChallan(organizationId, deliveryId, layout, actor);
      }
      throw error;
    }
  }

  private async buildChallanSnapshot(
    organizationId: string,
    deliveryId: string,
  ): Promise<DeliveryChallanSnapshot> {
    const d = await this.prisma.delivery.findFirstOrThrow({
      where: { id: deliveryId, organizationId },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        job: {
          include: {
            organization: { select: { displayName: true, timezone: true } },
            branch: true,
            customer: { select: { name: true, customerCode: true, phoneDisplay: true } },
            asset: { include: { category: { select: { name: true } } } },
          },
        },
      },
    });
    const [documents, delivery] = await Promise.all([
      this.settings.get(organizationId, 'documents'),
      this.settings.get(organizationId, 'delivery'),
    ]);
    const job = d.job;
    const timeZone = job.branch.timezone ?? job.organization.timezone ?? 'UTC';
    const address = d.address as {
      line1?: string;
      line2?: string;
      city?: string;
      postalCode?: string;
      countryCode?: string;
    } | null;
    const balance = d.balanceSnapshot as { due?: string; currency?: string | null } | null;
    const MODE: Record<string, string> = {
      CUSTOMER_PICKUP: 'Customer pick-up',
      HOME_DELIVERY: 'Home delivery',
      ON_SITE_RETURN: 'On-site return',
      OTHER: 'Other',
    };
    const REL: Record<string, string> = {
      SELF: 'Customer',
      AUTHORIZED_PERSON: 'Authorized person',
      FAMILY: 'Family member',
      COLLEAGUE: 'Colleague',
      OTHER: 'Other',
    };
    const due =
      balance?.due && balance.currency ? formatMoney(balance.due, balance.currency) : null;
    const device = `${job.asset.category.name}: ${job.asset.brand} ${job.asset.model}`;
    return {
      business: {
        name: job.organization.displayName,
        header: documents.businessHeader,
        branchName: job.branch.name,
        branchAddress:
          [job.branch.addressLine1, job.branch.city, job.branch.postalCode]
            .filter(Boolean)
            .join(', ') || null,
        branchPhone: job.branch.phone,
      },
      challanNumber: d.challanNumber,
      status: d.status,
      mode: MODE[d.mode] ?? d.mode,
      date: formatDateTime(d.deliveredAt ?? d.dispatchedAt ?? d.createdAt, timeZone),
      timeZone,
      customer: {
        name: job.customer.name,
        code: job.customer.customerCode,
        phone: job.customer.phoneDisplay,
      },
      address: address
        ? [address.line1, address.line2, address.city, address.postalCode, address.countryCode]
            .filter(Boolean)
            .join(', ')
        : null,
      jobNumber: job.jobNumber,
      device: { description: device, serialNumber: job.asset.serialNumber },
      items: d.items.length
        ? d.items.map((i) => ({
            description: i.description,
            returned: i.returned,
            condition: i.condition,
          }))
        : [device, ...job.accessoriesReceived].map((x) => ({
            description: x,
            returned: false,
            condition: null,
          })),
      recipient:
        d.recipientName && d.relationship
          ? {
              name: d.recipientName,
              relationship: REL[d.relationship] ?? d.relationship,
              authorizationNote: d.authorizationNote,
            }
          : null,
      balanceStatus: balance
        ? due && balance.due !== '0.0000'
          ? `Balance due at hand-over: ${due}${d.dueOverrideReason ? ' (delivery approved by manager)' : ''}`
          : 'Nothing due at hand-over'
        : 'To be confirmed at hand-over',
      terms: delivery.challanTerms,
      termsArePlaceholder: delivery.challanTerms === SETTINGS.delivery.default.challanTerms,
      generatedAt: `${formatDateTime(new Date(), timeZone)} (${timeZone})`,
    };
  }

  /** Tax invoice PDF (issued invoices only). Generated once; reprints return the same snapshot. */
  async taxInvoice(
    organizationId: string,
    invoiceId: string,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId, status: { not: 'DRAFT' } },
      include: {
        lines: { orderBy: { position: 'asc' } },
        taxSummaries: true,
        job: { select: { jobNumber: true } },
      },
    });
    if (!invoice) throw AppException.notFound('Invoice');
    const [business, invoicing] = await Promise.all([
      this.settings.get(organizationId, 'business'),
      this.settings.get(organizationId, 'invoicing'),
    ]);
    const m2 = (v: { toFixed(n: number): string }) => v.toFixed(2);
    const snapshot: TaxDocSnapshot = {
      kind: invoice.documentType,
      number: invoice.invoiceNumber ?? '',
      date: invoice.invoiceDate?.toISOString().slice(0, 10) ?? '',
      reference: null,
      reason: null,
      supplier: invoice.supplier as unknown as TaxDocSnapshot['supplier'],
      recipient: invoice.recipient as unknown as TaxDocSnapshot['recipient'],
      supplyType: invoice.supplyType,
      placeOfSupply: {
        code: invoice.placeOfSupplyCode,
        name: stateName(invoice.placeOfSupplyCode) ?? '',
      },
      jobNumber: invoice.job.jobNumber,
      currency: invoice.currency,
      lines: invoice.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac,
        quantity: l.quantity.toString(),
        unit: l.unit,
        unitPrice: m2(l.unitPrice),
        discount: m2(l.discount),
        taxableValue: m2(l.taxableValue),
        gstRate: l.gstRate.toString(),
        cgstAmount: m2(l.cgstAmount),
        sgstAmount: m2(l.sgstAmount),
        igstAmount: m2(l.igstAmount),
      })),
      hsnSummary: invoice.taxSummaries
        .map((t) => ({
          hsnSac: t.hsnSac,
          gstRate: t.gstRate.toString(),
          taxableValue: m2(t.taxableValue),
          cgstAmount: m2(t.cgstAmount),
          sgstAmount: m2(t.sgstAmount),
          igstAmount: m2(t.igstAmount),
        }))
        .sort((a, b) => a.hsnSac.localeCompare(b.hsnSac)),
      totals: {
        taxable: m2(invoice.taxableTotal),
        cgst: m2(invoice.cgstTotal),
        sgst: m2(invoice.sgstTotal),
        igst: m2(invoice.igstTotal),
        roundOff: m2(invoice.roundOff),
        total: m2(invoice.total),
      },
      amountInWords: amountInWordsINR(m2(invoice.total)),
      terms: invoice.terms,
      termsArePlaceholder: invoice.terms === SETTINGS.invoicing.default.terms,
      declaration: invoicing.declaration,
      signatory: {
        name: business?.signatoryName ?? null,
        designation: business?.signatoryDesignation ?? null,
      },
      contact: business
        ? [...business.phones, ...business.emails, business.website ?? '']
            .filter(Boolean)
            .join(' · ')
        : '',
      generatedAt: new Date().toISOString(),
    };
    return this.generateOnce(
      organizationId,
      invoice.branchId,
      'invoice',
      invoiceId,
      invoice.documentType,
      snapshot,
      actor,
    );
  }

  /** Credit note PDF from its immutable snapshot. */
  async creditNote(
    organizationId: string,
    creditNoteId: string,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const note = await this.prisma.creditNote.findFirst({
      where: { id: creditNoteId, organizationId },
      include: { invoice: { select: { job: { select: { jobNumber: true } } } } },
    });
    if (!note) throw AppException.notFound('Credit note');
    const s = note.snapshot as unknown as {
      noteDate: string;
      reason: string;
      invoice: { number: string; documentType?: 'TAX_INVOICE' | 'BILL_OF_SUPPLY' };
      supplier: TaxDocSnapshot['supplier'];
      recipient: TaxDocSnapshot['recipient'];
      supplyType: TaxDocSnapshot['supplyType'];
      placeOfSupplyCode: string;
      currency: string;
      lines: TaxDocSnapshot['lines'];
      totals: TaxDocSnapshot['totals'];
      amountInWords: string;
    };
    const business = await this.settings.get(organizationId, 'business');
    const snapshot: TaxDocSnapshot = {
      kind: 'CREDIT_NOTE',
      withoutGst: s.invoice.documentType === 'BILL_OF_SUPPLY',
      number: note.creditNoteNumber,
      date: s.noteDate,
      reference: {
        label:
          s.invoice.documentType === 'BILL_OF_SUPPLY'
            ? 'Against bill of supply'
            : 'Against invoice',
        value: s.invoice.number,
      },
      reason: s.reason,
      supplier: s.supplier,
      recipient: s.recipient,
      supplyType: s.supplyType,
      placeOfSupply: { code: s.placeOfSupplyCode, name: stateName(s.placeOfSupplyCode) ?? '' },
      jobNumber: note.invoice.job.jobNumber,
      currency: s.currency,
      lines: s.lines,
      hsnSummary: summarizeByHsn(
        s.lines.map((l) => ({
          hsnSac: l.hsnSac,
          gstRate: l.gstRate,
          taxableValue: l.taxableValue,
          cgstAmount: l.cgstAmount,
          sgstAmount: l.sgstAmount,
          igstAmount: l.igstAmount,
          cgstRate: '0',
          sgstRate: '0',
          igstRate: '0',
          lineTotal: '0',
        })),
      ),
      totals: s.totals,
      amountInWords: s.amountInWords,
      terms: null,
      termsArePlaceholder: false,
      declaration: null,
      signatory: {
        name: business?.signatoryName ?? null,
        designation: business?.signatoryDesignation ?? null,
      },
      contact: business ? [...business.phones, ...business.emails].join(' · ') : '',
      generatedAt: new Date().toISOString(),
    };
    return this.generateOnce(
      organizationId,
      note.branchId,
      'credit_note',
      creditNoteId,
      'CREDIT_NOTE',
      snapshot,
      actor,
    );
  }

  private async generateOnce(
    organizationId: string,
    branchId: string,
    entityType: string,
    entityId: string,
    documentType: 'TAX_INVOICE' | 'BILL_OF_SUPPLY' | 'CREDIT_NOTE',
    snapshot: TaxDocSnapshot,
    actor: { userId: string | null },
  ): Promise<DocumentLink> {
    const existing = await this.prisma.document.findFirst({
      where: { organizationId, entityType, entityId, documentType },
      orderBy: { version: 'desc' },
      select: { id: true, documentNumber: true, version: true, fileId: true },
    });
    if (existing) return this.link(organizationId, existing);
    const pdf = await this.renderer.render(renderTaxDocumentHtml(snapshot));
    try {
      const document = await this.prisma.$transaction(async (tx) => {
        const fileId = await this.files.storeGenerated(
          organizationId,
          pdf,
          `${documentType.toLowerCase()}-${snapshot.number}.pdf`,
          'application/pdf',
          tx,
        );
        const created = await tx.document.create({
          data: {
            organizationId,
            branchId,
            documentType,
            entityType,
            entityId,
            documentNumber: snapshot.number,
            layout: 'A4',
            version: 1,
            fileId,
            snapshot: snapshot as unknown as Prisma.InputJsonValue,
            generatedById: actor.userId,
          },
          select: { id: true, documentNumber: true, version: true, fileId: true },
        });
        await this.audit.record(tx, {
          organizationId,
          branchId,
          actorUserId: actor.userId,
          actorType: actor.userId ? 'USER' : 'SYSTEM',
          action: 'document.generated',
          entityType: 'document',
          entityId: created.id,
          after: { documentType, entityId },
        });
        return created;
      });
      return await this.link(organizationId, document);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.generateOnce(
          organizationId,
          branchId,
          entityType,
          entityId,
          documentType,
          snapshot,
          actor,
        );
      }
      throw error;
    }
  }

  private async link(
    organizationId: string,
    document: { id: string; documentNumber: string; version: number; fileId: string },
  ): Promise<DocumentLink> {
    const { url, expiresAt } = await this.files.signedUrl(organizationId, document.fileId);
    return {
      documentId: document.id,
      documentNumber: document.documentNumber,
      version: document.version,
      url,
      expiresAt,
    };
  }

  private async buildSnapshot(organizationId: string, jobId: string): Promise<JobReceiptSnapshot> {
    const job = await this.prisma.serviceJob.findFirst({
      where: { id: jobId, organizationId },
      include: {
        organization: { select: { displayName: true, timezone: true } },
        branch: true,
        customer: { select: { name: true, customerCode: true, phoneDisplay: true, email: true } },
        asset: { include: { category: { select: { name: true } } } },
      },
    });
    if (!job) throw AppException.notFound('Job');
    const documents = await this.settings.get(organizationId, 'documents');
    const timeZone = job.branch.timezone ?? job.organization.timezone ?? 'UTC';
    const branchAddress = [
      job.branch.addressLine1,
      job.branch.addressLine2,
      job.branch.city,
      job.branch.postalCode,
    ]
      .filter(Boolean)
      .join(', ');
    return {
      business: {
        name: job.organization.displayName,
        header: documents.businessHeader,
        branchName: job.branch.name,
        branchAddress: branchAddress || null,
        branchPhone: job.branch.phone,
      },
      job: {
        number: job.jobNumber,
        receivedAt: formatDateTime(job.receivedAt ?? job.createdAt, timeZone),
        timeZone,
        serviceType: SERVICE_TYPE_LABELS[job.serviceType],
        serviceMode: SERVICE_MODE_LABELS[job.serviceMode],
        status: CUSTOMER_STATUS_LABELS[CUSTOMER_STATUS_BY_JOB_STATUS[job.status]],
        expectedCompletionDate: job.expectedCompletionDate?.toISOString().slice(0, 10) ?? null,
      },
      customer: {
        name: job.customer.name,
        code: job.customer.customerCode,
        phone: job.customer.phoneDisplay,
        email: job.customer.email,
      },
      device: {
        category: job.asset.category.name,
        brand: job.asset.brand,
        model: job.asset.model,
        serialNumber: job.asset.serialNumber,
        assetTag: job.asset.assetTag,
      },
      complaint: job.complaint,
      accessories: job.accessoriesReceived,
      checklist: job.intakeChecklist as ChecklistItem[],
      conditionNotes: job.conditionNotes,
      terms: documents.jobReceiptTerms,
      termsArePlaceholder: documents.jobReceiptTerms === SETTINGS.documents.default.jobReceiptTerms,
      generatedAt: `${formatDateTime(new Date(), timeZone)} (${timeZone})`,
    };
  }
}
