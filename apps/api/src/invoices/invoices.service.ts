import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type BusinessProfile,
  type CreditNoteRequest,
  type GstLineResult,
  GstInputError,
  type Invoice,
  type InvoiceLineInput,
  type InvoiceSummary,
  type Page,
  type SupplyType,
  type TaxSettings,
  amountInWordsINR,
  computeGstLine,
  computeGstTotals,
  financialYear,
  stateCodeFromGstin,
  stateCodeFromName,
  stateName,
  summarizeByHsn,
  supplyTypeFor,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { branchFilter, canAccessBranch } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { enqueueNotification } from '../notifications/outbox.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { allocate, autoAllocate, releaseAllocation } from './allocation.js';

const D = Prisma.Decimal;
type Decimal = Prisma.Decimal;
type Db = Prisma.TransactionClient | PrismaClient;

/** Jobs whose repair is finished may be invoiced (CLAUDE.md §1: final invoice after repair completion). */
const INVOICEABLE = new Set([
  'REPAIR_COMPLETED',
  'READY_FOR_DELIVERY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);

export interface Party {
  name: string;
  gstin: string | null;
  address: string;
  stateCode: string;
  stateName: string;
}

interface Config {
  business: BusinessProfile | null;
  tax: TaxSettings;
  currency: string | null;
  timezone: string;
  fyStartMonth: number;
  terms: string;
}

const m2 = (d: Decimal | string | number) => new D(d.toString()).toFixed(2);
const today = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

const LINE_SELECT = { orderBy: { position: 'asc' as const } };

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ configuration

  async config(organizationId: string, db: Db = this.prisma): Promise<Config> {
    const [business, tax, invoicing, money, org] = await Promise.all([
      this.settings.get(organizationId, 'business', db),
      this.settings.get(organizationId, 'tax', db),
      this.settings.get(organizationId, 'invoicing', db),
      this.settings.get(organizationId, 'money', db),
      db.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { timezone: true },
      }),
    ]);
    return {
      business,
      tax,
      currency: money.currency,
      timezone: org.timezone ?? 'UTC',
      fyStartMonth: invoicing.financialYearStartMonth,
      terms: invoicing.terms,
    };
  }

  /** Reasons an invoice cannot be issued yet (shown on drafts). */
  blockers(config: Config): string[] {
    const out: string[] = [];
    if (!config.business)
      out.push('Enter the business profile (name, address, GSTIN) in settings.');
    else if (!config.business.gstin) out.push('Enter the business GSTIN in the business profile.');
    if (config.tax.status !== 'APPROVED')
      out.push('The tax configuration has not been approved yet (settings → tax).');
    if (!config.currency) out.push('Set the business currency in settings.');
    return out;
  }

  private supplierState(config: Config): string {
    return config.business?.address.stateCode ?? '19';
  }

  private supplier(config: Config): Party | null {
    const b = config.business;
    if (!b) return null;
    const a = b.address;
    return {
      name:
        b.tradeName && b.tradeName !== b.legalName
          ? `${b.legalName} (${b.tradeName})`
          : b.legalName,
      gstin: b.gstin,
      address: [a.line1, a.line2, `${a.city} - ${a.postalCode}`, stateName(a.stateCode)]
        .filter(Boolean)
        .join(', '),
      stateCode: a.stateCode,
      stateName: stateName(a.stateCode) ?? '',
    };
  }

  /** Recipient + place of supply (ADR 0022): GSTIN state, else address state, else the business's state. */
  async recipient(
    db: Db,
    organizationId: string,
    customerId: string,
    config: Config,
  ): Promise<Party> {
    const customer = await db.customer.findFirstOrThrow({
      where: { id: customerId, organizationId },
      select: { name: true, taxIdentifier: true, addresses: true },
    });
    const gstin =
      customer.taxIdentifier && stateCodeFromGstin(customer.taxIdentifier)
        ? customer.taxIdentifier.trim().toUpperCase()
        : null;
    const address =
      customer.addresses.find((a) => a.kind === 'BILLING') ?? customer.addresses[0] ?? null;
    const stateCode =
      stateCodeFromGstin(gstin) ??
      (address?.countryCode === 'IN' ? stateCodeFromName(address.region) : null) ??
      this.supplierState(config);
    return {
      name: customer.name,
      gstin,
      address: address
        ? [address.line1, address.line2, address.city, address.region, address.postalCode]
            .filter(Boolean)
            .join(', ')
        : '',
      stateCode,
      stateName: stateName(stateCode) ?? '',
    };
  }

  private categoryFor(
    tax: TaxSettings,
    input: { lineType: InvoiceLineInput['lineType']; taxCategory?: string | undefined },
  ) {
    const code = input.taxCategory ?? tax.lineTypeCategory[input.lineType];
    const category = tax.categories.find((c) => c.code === code);
    if (!category)
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        `Unknown tax category ${code ?? ''}`,
      );
    return category;
  }

  private rateOn(category: TaxSettings['categories'][number], date: string): string {
    const rate = [...category.rates]
      .filter((r) => r.effectiveFrom <= date)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
    if (!rate)
      throw new AppException(
        HttpStatus.CONFLICT,
        'CONFIGURATION_REQUIRED',
        `No ${category.name} tax rate in force on ${date}`,
      );
    return rate.ratePercent;
  }

  private computeLines(
    lines: readonly InvoiceLineInput[],
    tax: TaxSettings,
    supply: SupplyType,
    date: string,
  ) {
    try {
      return lines.map((l, i) => {
        const category = this.categoryFor(tax, l);
        const gstRate = this.rateOn(category, date);
        const result = computeGstLine(
          { quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, gstRate },
          supply,
        );
        return { input: l, position: i + 1, category, gstRate, result };
      });
    } catch (error) {
      if (error instanceof GstInputError)
        throw new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', error.message);
      throw error;
    }
  }

  private async writeLines(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    computed: ReturnType<InvoicesService['computeLines']>,
    sources: (string | null)[] = [],
  ) {
    await tx.invoiceLine.deleteMany({ where: { invoiceId } });
    if (computed.length === 0) return;
    await tx.invoiceLine.createMany({
      data: computed.map((c, i) => ({
        invoiceId,
        position: c.position,
        lineType: c.input.lineType,
        description: c.input.description,
        hsnSac: c.category.hsnSac,
        quantity: c.input.quantity,
        unit: c.input.unit,
        unitPrice: c.input.unitPrice,
        discount: c.input.discount,
        taxableValue: c.result.taxableValue,
        taxCategory: c.category.code,
        gstRate: c.gstRate,
        cgstRate: c.result.cgstRate,
        sgstRate: c.result.sgstRate,
        igstRate: c.result.igstRate,
        cgstAmount: c.result.cgstAmount,
        sgstAmount: c.result.sgstAmount,
        igstAmount: c.result.igstAmount,
        lineTotal: c.result.lineTotal,
        sourceEstimateLineId: sources[i] ?? null,
      })),
    });
  }

  private totalsData(computed: { result: GstLineResult }[], tax: TaxSettings) {
    const t = computeGstTotals(
      computed.map((c) => c.result),
      tax.roundOff,
    );
    return {
      taxableTotal: t.taxableTotal,
      cgstTotal: t.cgstTotal,
      sgstTotal: t.sgstTotal,
      igstTotal: t.igstTotal,
      taxTotal: t.taxTotal,
      roundOff: t.roundOff,
      total: t.total,
    };
  }

  // ------------------------------------------------------------ scope helpers

  private async jobInScope(principal: Principal, jobId: string, db: Db = this.prisma) {
    const job = await db.serviceJob.findFirst({
      where: { id: jobId, organizationId: principal.organizationId, ...branchFilter(principal) },
      select: { id: true, branchId: true, customerId: true, status: true, jobNumber: true },
    });
    if (!job) throw AppException.notFound('Job');
    return job;
  }

  private async invoiceInScope(principal: Principal, id: string, db: Db = this.prisma) {
    const invoice = await db.invoice.findFirst({
      where: { id, organizationId: principal.organizationId, ...branchFilter(principal) },
    });
    if (!invoice) throw AppException.notFound('Invoice');
    return invoice;
  }

  // ------------------------------------------------------------ drafts

  async createDraft(principal: Principal, jobId: string): Promise<Invoice> {
    const job = await this.jobInScope(principal, jobId);
    if (!INVOICEABLE.has(job.status)) {
      throw AppException.conflict('An invoice can be prepared once the repair is completed.');
    }
    const existing = await this.prisma.invoice.findFirst({
      where: { jobId, status: 'DRAFT' },
      select: { id: true },
    });
    if (existing) return this.get(principal, existing.id);
    const config = await this.config(principal.organizationId);
    const estimate = await this.prisma.estimate.findFirst({
      where: { jobId, status: { notIn: ['DRAFT', 'WITHDRAWN'] } },
      orderBy: { version: 'desc' },
      include: { lines: { orderBy: { position: 'asc' } } },
    });
    const sourceLines =
      estimate?.status === 'APPROVED'
        ? estimate.lines.filter((l) => l.coverage === 'CUSTOMER_PAY')
        : [];
    const inputs: InvoiceLineInput[] = sourceLines.map((l) => ({
      lineType: l.lineType,
      description: l.description,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: l.unitPrice.toString(),
      discount: l.discount.toString(),
    }));
    const id = await this.prisma.$transaction(async (tx) => {
      const recipient = await this.recipient(tx, principal.organizationId, job.customerId, config);
      const supply = supplyTypeFor(this.supplierState(config), recipient.stateCode);
      const computed = this.computeLines(inputs, config.tax, supply, today(config.timezone));
      const created = await tx.invoice.create({
        data: {
          organizationId: principal.organizationId,
          branchId: job.branchId,
          jobId,
          customerId: job.customerId,
          sourceEstimateId: estimate?.status === 'APPROVED' ? estimate.id : null,
          currency: config.currency ?? estimate?.currency ?? 'XXX',
          supplyType: supply,
          placeOfSupplyCode: recipient.stateCode,
          recipient: recipient as unknown as Prisma.InputJsonValue,
          createdById: principal.userId,
          ...this.totalsData(computed, config.tax),
        },
        select: { id: true },
      });
      await this.writeLines(
        tx,
        created.id,
        computed,
        sourceLines.map((l) => l.id),
      );
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'invoice.draft_created',
        entityType: 'invoice',
        entityId: created.id,
        after: {
          jobId,
          fromEstimate: estimate?.status === 'APPROVED' ? estimate.version : null,
          lines: inputs.length,
        },
      });
      return created.id;
    });
    return this.get(principal, id);
  }

  async updateDraft(
    principal: Principal,
    id: string,
    input: { rowVersion: number; lines: InvoiceLineInput[]; notes?: string | null | undefined },
  ): Promise<Invoice> {
    const config = await this.config(principal.organizationId);
    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoiceInScope(principal, id, tx);
      if (invoice.status !== 'DRAFT')
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVOICE_NOT_EDITABLE',
          'Issued invoices cannot be edited; issue a credit note instead.',
        );
      const recipient = await this.recipient(
        tx,
        principal.organizationId,
        invoice.customerId,
        config,
      );
      const supply = supplyTypeFor(this.supplierState(config), recipient.stateCode);
      const computed = this.computeLines(input.lines, config.tax, supply, today(config.timezone));
      const updated = await tx.invoice.updateMany({
        where: { id, status: 'DRAFT', rowVersion: input.rowVersion },
        data: {
          rowVersion: { increment: 1 },
          supplyType: supply,
          placeOfSupplyCode: recipient.stateCode,
          recipient: recipient as unknown as Prisma.InputJsonValue,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...this.totalsData(computed, config.tax),
        },
      });
      if (updated.count !== 1)
        throw new AppException(
          HttpStatus.CONFLICT,
          'VERSION_CONFLICT',
          'The draft changed; reload and try again.',
        );
      await this.writeLines(tx, id, computed);
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: invoice.branchId,
        actorUserId: principal.userId,
        action: 'invoice.draft_updated',
        entityType: 'invoice',
        entityId: id,
        after: { lines: input.lines.length },
      });
    });
    return this.get(principal, id);
  }

  async deleteDraft(principal: Principal, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoiceInScope(principal, id, tx);
      if (invoice.status !== 'DRAFT')
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVOICE_NOT_EDITABLE',
          'Issued invoices are never deleted.',
        );
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: invoice.branchId,
        actorUserId: principal.userId,
        action: 'invoice.draft_deleted',
        entityType: 'invoice',
        entityId: id,
      });
    });
  }

  // ------------------------------------------------------------ issue

  async issue(
    principal: Principal,
    id: string,
    key: string,
  ): Promise<{ status: number; body: Invoice; replayed: boolean }> {
    const outcome = await this.prisma.$transaction(async (tx) =>
      runIdempotent(
        tx,
        {
          organizationId: principal.organizationId,
          actorKey: `user:${principal.userId}`,
          operation: 'invoices.issue',
        },
        key,
        { id },
        async () => {
          await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${id}::uuid FOR UPDATE`;
          const invoice = await this.invoiceInScope(principal, id, tx);
          if (invoice.status !== 'DRAFT')
            throw new AppException(
              HttpStatus.CONFLICT,
              'INVOICE_NOT_EDITABLE',
              'This invoice has already been issued.',
            );
          const config = await this.config(principal.organizationId, tx);
          const blockers = this.blockers(config);
          if (config.tax.status !== 'APPROVED') {
            throw new AppException(
              HttpStatus.CONFLICT,
              'TAX_CONFIG_NOT_APPROVED',
              'Invoices can be issued only after the tax configuration is approved.',
            );
          }
          if (blockers.length > 0)
            throw new AppException(
              HttpStatus.CONFLICT,
              'CONFIGURATION_REQUIRED',
              blockers.join(' '),
            );
          const lines = await tx.invoiceLine.findMany({ where: { invoiceId: id }, ...LINE_SELECT });
          if (lines.length === 0)
            throw new AppException(
              HttpStatus.CONFLICT,
              'NOTHING_TO_INVOICE',
              'Add at least one chargeable line.',
            );
          const job = await tx.serviceJob.findUniqueOrThrow({
            where: { id: invoice.jobId },
            select: { jobNumber: true, status: true, branch: { select: { id: true, code: true } } },
          });
          if (!INVOICEABLE.has(job.status))
            throw AppException.conflict('The repair must be completed before invoicing.');

          const invoiceDate = today(config.timezone);
          const fy = financialYear(new Date(), config.fyStartMonth, config.timezone);
          const recipient = await this.recipient(
            tx,
            principal.organizationId,
            invoice.customerId,
            config,
          );
          const supply = supplyTypeFor(this.supplierState(config), recipient.stateCode);
          // Final calculation with the approved configuration and the rates in force today.
          const computed = this.computeLines(
            lines.map((l) => ({
              lineType: l.lineType,
              description: l.description,
              quantity: l.quantity.toString(),
              unit: l.unit,
              unitPrice: l.unitPrice.toString(),
              discount: l.discount.toString(),
              taxCategory: l.taxCategory,
            })),
            config.tax,
            supply,
            invoiceDate,
          );
          const totals = this.totalsData(computed, config.tax);
          if (new D(totals.total).lte(0))
            throw new AppException(
              HttpStatus.CONFLICT,
              'NOTHING_TO_INVOICE',
              'The invoice total must be more than zero.',
            );
          // Update in place so line IDs stay stable for credit notes and clients.
          for (const [i, c] of computed.entries()) {
            const line = lines[i];
            if (!line) continue;
            await tx.invoiceLine.update({
              where: { id: line.id },
              data: {
                hsnSac: c.category.hsnSac,
                taxCategory: c.category.code,
                gstRate: c.gstRate,
                taxableValue: c.result.taxableValue,
                cgstRate: c.result.cgstRate,
                sgstRate: c.result.sgstRate,
                igstRate: c.result.igstRate,
                cgstAmount: c.result.cgstAmount,
                sgstAmount: c.result.sgstAmount,
                igstAmount: c.result.igstAmount,
                lineTotal: c.result.lineTotal,
              },
            });
          }
          const format = await this.settings.get(
            principal.organizationId,
            'numbering.invoiceNumber',
            tx,
          );
          const number = await this.numbering.next(tx, {
            organizationId: principal.organizationId,
            documentType: 'TAX_INVOICE',
            format,
            timeZone: config.timezone,
            financialYearStartMonth: config.fyStartMonth,
          });
          if (number.length > 16) {
            throw new AppException(
              HttpStatus.CONFLICT,
              'CONFIGURATION_REQUIRED',
              'Invoice numbers must be at most 16 characters; shorten the format in settings.',
            );
          }
          await tx.invoice.update({
            where: { id },
            data: {
              status: 'ISSUED',
              invoiceNumber: number,
              financialYear: fy.label,
              invoiceDate: new Date(`${invoiceDate}T00:00:00Z`),
              currency: config.currency ?? invoice.currency,
              supplyType: supply,
              placeOfSupplyCode: recipient.stateCode,
              supplier: this.supplier(config) as unknown as Prisma.InputJsonValue,
              recipient: recipient as unknown as Prisma.InputJsonValue,
              terms: config.terms,
              issuedAt: new Date(),
              issuedById: principal.userId,
              rowVersion: { increment: 1 },
              ...totals,
            },
          });
          const summary = summarizeByHsn(
            computed.map((c) => ({ ...c.result, hsnSac: c.category.hsnSac, gstRate: c.gstRate })),
          );
          await tx.invoiceTaxSummary.createMany({
            data: summary.map((s) => ({
              invoiceId: id,
              hsnSac: s.hsnSac,
              gstRate: s.gstRate,
              taxableValue: s.taxableValue,
              cgstAmount: s.cgstAmount,
              sgstAmount: s.sgstAmount,
              igstAmount: s.igstAmount,
            })),
          });
          const allocated = await autoAllocate(tx, {
            organizationId: principal.organizationId,
            invoiceId: id,
            actorUserId: principal.userId,
          });
          await enqueueNotification(tx, {
            organizationId: principal.organizationId,
            branchId: invoice.branchId,
            jobId: invoice.jobId,
            customerId: invoice.customerId,
            eventType: 'INVOICE_ISSUED',
            payload: {
              jobNumber: job.jobNumber,
              invoiceNumber: number,
              amount: totals.total,
              currency: config.currency,
            },
            dedupeKey: id,
          });
          await this.audit.record(tx, {
            organizationId: principal.organizationId,
            branchId: invoice.branchId,
            actorUserId: principal.userId,
            action: 'invoice.issued',
            entityType: 'invoice',
            entityId: id,
            after: {
              invoiceNumber: number,
              total: totals.total,
              supplyType: supply,
              placeOfSupply: recipient.stateCode,
              allocated: allocated.toFixed(2),
            },
          });
          return { status: 200, body: { id } as unknown as Invoice, resourceId: id };
        },
      ),
    );
    return { ...outcome, body: await this.get(principal, id) };
  }

  // ------------------------------------------------------------ credit notes

  async creditNote(
    principal: Principal,
    invoiceId: string,
    input: CreditNoteRequest,
    key: string,
  ): Promise<{ status: number; body: Invoice; replayed: boolean }> {
    const outcome = await this.prisma.$transaction(async (tx) =>
      runIdempotent(
        tx,
        {
          organizationId: principal.organizationId,
          actorKey: `user:${principal.userId}`,
          operation: 'invoices.credit_note',
        },
        key,
        { invoiceId, ...input },
        async () => {
          await tx.$queryRaw`SELECT "id" FROM "invoices" WHERE "id" = ${invoiceId}::uuid FOR UPDATE`;
          const invoice = await this.invoiceInScope(principal, invoiceId, tx);
          if (invoice.status !== 'ISSUED')
            throw new AppException(
              HttpStatus.CONFLICT,
              'INVOICE_NOT_EDITABLE',
              'Only issued, not fully credited invoices can be credited.',
            );
          const config = await this.config(principal.organizationId, tx);
          const lines = await tx.invoiceLine.findMany({ where: { invoiceId }, ...LINE_SELECT });
          const previous = await tx.creditNoteLine.findMany({
            where: { creditNote: { invoiceId } },
          });
          const creditedOf = (
            lineId: string,
            k: 'taxableValue' | 'cgstAmount' | 'sgstAmount' | 'igstAmount' | 'lineTotal',
          ) =>
            previous
              .filter((p) => p.invoiceLineId === lineId)
              .reduce((s, p) => s.plus(p[k]), new D(0));
          const wanted = input.full
            ? lines
                .filter((l) => l.quantity.gt(l.creditedQuantity))
                .map((l) => ({ line: l, qty: l.quantity.minus(l.creditedQuantity) }))
            : input.lines.map((r) => {
                const line = lines.find((l) => l.id === r.invoiceLineId);
                if (!line)
                  throw new AppException(
                    HttpStatus.BAD_REQUEST,
                    'VALIDATION_FAILED',
                    'Unknown invoice line',
                  );
                const qty = new D(r.quantity);
                if (qty.lte(0) || qty.gt(line.quantity.minus(line.creditedQuantity))) {
                  throw new AppException(
                    HttpStatus.BAD_REQUEST,
                    'CREDIT_EXCEEDS_INVOICE',
                    `Cannot credit more than remains on "${line.description}".`,
                  );
                }
                return { line, qty };
              });
          if (wanted.length === 0)
            throw new AppException(
              HttpStatus.CONFLICT,
              'CREDIT_EXCEEDS_INVOICE',
              'Nothing remains to be credited.',
            );
          const supply = invoice.supplyType;
          const creditLines = wanted.map(({ line, qty }) => {
            const fullyCredited = line.creditedQuantity.plus(qty).eq(line.quantity);
            if (fullyCredited) {
              // Exact remainder so the invoice line is credited to the paisa.
              return {
                line,
                qty,
                taxableValue: line.taxableValue.minus(creditedOf(line.id, 'taxableValue')),
                cgstAmount: line.cgstAmount.minus(creditedOf(line.id, 'cgstAmount')),
                sgstAmount: line.sgstAmount.minus(creditedOf(line.id, 'sgstAmount')),
                igstAmount: line.igstAmount.minus(creditedOf(line.id, 'igstAmount')),
              };
            }
            const discount = line.discount.times(qty).dividedBy(line.quantity);
            const r = computeGstLine(
              {
                quantity: qty.toString(),
                unitPrice: line.unitPrice.toString(),
                discount: discount.toFixed(4),
                gstRate: line.gstRate.toString(),
              },
              supply,
            );
            return {
              line,
              qty,
              taxableValue: new D(r.taxableValue),
              cgstAmount: new D(r.cgstAmount),
              sgstAmount: new D(r.sgstAmount),
              igstAmount: new D(r.igstAmount),
            };
          });
          const sum = (k: 'taxableValue' | 'cgstAmount' | 'sgstAmount' | 'igstAmount') =>
            creditLines.reduce((s, l) => s.plus(l[k]), new D(0));
          const exact = sum('taxableValue')
            .plus(sum('cgstAmount'))
            .plus(sum('sgstAmount'))
            .plus(sum('igstAmount'));
          const remaining = invoice.total.minus(invoice.creditedTotal);
          const fullCancellation = lines.every((l) => {
            const c = creditLines.find((x) => x.line.id === l.id);
            return l.creditedQuantity.plus(c?.qty ?? 0).eq(l.quantity);
          });
          let total = fullCancellation
            ? remaining
            : config.tax.roundOff === 'NEAREST_RUPEE'
              ? exact.toDecimalPlaces(0, D.ROUND_HALF_UP)
              : exact;
          if (total.gt(remaining)) total = remaining;
          if (total.lte(0))
            throw new AppException(
              HttpStatus.CONFLICT,
              'CREDIT_EXCEEDS_INVOICE',
              'Nothing remains to be credited.',
            );
          const roundOff = total.minus(exact);

          // Free allocations that would exceed the new open balance (newest first).
          let excess = invoice.allocatedTotal
            .plus(invoice.creditedTotal)
            .plus(total)
            .minus(invoice.total);
          if (excess.gt(0)) {
            const active = await tx.paymentAllocation.findMany({
              where: { invoiceId, releasedAt: null },
              orderBy: { createdAt: 'desc' },
            });
            for (const a of active) {
              if (excess.lte(0)) break;
              await releaseAllocation(tx, {
                organizationId: principal.organizationId,
                allocationId: a.id,
                actorUserId: principal.userId,
                reason: 'Credit note issued',
              });
              const keep = a.amount.minus(excess);
              if (keep.gt(0)) {
                await allocate(tx, {
                  organizationId: principal.organizationId,
                  invoiceId,
                  paymentId: a.paymentId,
                  amount: keep,
                  actorUserId: principal.userId,
                });
              }
              excess = excess.minus(a.amount);
            }
          }

          const fy = financialYear(new Date(), config.fyStartMonth, config.timezone);
          const format = await this.settings.get(
            principal.organizationId,
            'numbering.creditNoteNumber',
            tx,
          );
          const number = await this.numbering.next(tx, {
            organizationId: principal.organizationId,
            documentType: 'CREDIT_NOTE',
            format,
            timeZone: config.timezone,
            financialYearStartMonth: config.fyStartMonth,
          });
          const noteDate = today(config.timezone);
          const snapshot = {
            creditNoteNumber: number,
            noteDate,
            reason: input.reason,
            invoice: {
              number: invoice.invoiceNumber,
              date: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
            },
            supplier: invoice.supplier,
            recipient: invoice.recipient,
            supplyType: invoice.supplyType,
            placeOfSupplyCode: invoice.placeOfSupplyCode,
            currency: invoice.currency,
            lines: creditLines.map((c) => ({
              description: c.line.description,
              hsnSac: c.line.hsnSac,
              quantity: c.qty.toString(),
              unit: c.line.unit,
              gstRate: c.line.gstRate.toString(),
              taxableValue: m2(c.taxableValue),
              cgstAmount: m2(c.cgstAmount),
              sgstAmount: m2(c.sgstAmount),
              igstAmount: m2(c.igstAmount),
            })),
            totals: {
              taxable: m2(sum('taxableValue')),
              cgst: m2(sum('cgstAmount')),
              sgst: m2(sum('sgstAmount')),
              igst: m2(sum('igstAmount')),
              roundOff: m2(roundOff),
              total: m2(total),
            },
            amountInWords: amountInWordsINR(m2(total)),
          };
          const note = await tx.creditNote.create({
            data: {
              organizationId: principal.organizationId,
              branchId: invoice.branchId,
              invoiceId,
              creditNoteNumber: number,
              financialYear: fy.label,
              noteDate: new Date(`${noteDate}T00:00:00Z`),
              reason: input.reason,
              isFull: fullCancellation,
              taxableTotal: sum('taxableValue'),
              cgstTotal: sum('cgstAmount'),
              sgstTotal: sum('sgstAmount'),
              igstTotal: sum('igstAmount'),
              roundOff,
              total,
              snapshot: snapshot,
              createdById: principal.userId,
              lines: {
                create: creditLines.map((c) => ({
                  invoiceLineId: c.line.id,
                  quantity: c.qty,
                  taxableValue: c.taxableValue,
                  cgstAmount: c.cgstAmount,
                  sgstAmount: c.sgstAmount,
                  igstAmount: c.igstAmount,
                  lineTotal: c.taxableValue
                    .plus(c.cgstAmount)
                    .plus(c.sgstAmount)
                    .plus(c.igstAmount),
                })),
              },
            },
            select: { id: true },
          });
          for (const c of creditLines) {
            await tx.invoiceLine.update({
              where: { id: c.line.id },
              data: { creditedQuantity: c.line.creditedQuantity.plus(c.qty) },
            });
          }
          const newCredited = invoice.creditedTotal.plus(total);
          await tx.invoice.update({
            where: { id: invoiceId },
            data: {
              creditedTotal: newCredited,
              ...(newCredited.eq(invoice.total)
                ? { status: 'CANCELLED', cancelledAt: new Date() }
                : {}),
            },
          });
          await this.audit.record(tx, {
            organizationId: principal.organizationId,
            branchId: invoice.branchId,
            actorUserId: principal.userId,
            action: fullCancellation
              ? 'invoice.cancelled_by_credit_note'
              : 'invoice.credit_note_issued',
            entityType: 'invoice',
            entityId: invoiceId,
            after: { creditNoteId: note.id, creditNoteNumber: number, total: m2(total) },
            reason: input.reason,
          });
          return {
            status: 201,
            body: { id: invoiceId } as unknown as Invoice,
            resourceId: note.id,
          };
        },
      ),
    );
    return { ...outcome, body: await this.get(principal, invoiceId) };
  }

  // ------------------------------------------------------------ allocations

  async allocatePayment(
    principal: Principal,
    invoiceId: string,
    input: { paymentId: string; amount: string },
  ): Promise<Invoice> {
    await this.prisma.$transaction(async (tx) => {
      const invoice = await this.invoiceInScope(principal, invoiceId, tx);
      if (invoice.status !== 'ISSUED')
        throw AppException.conflict('Only issued invoices can receive payments.');
      const payment = await tx.payment.findFirst({
        where: {
          id: input.paymentId,
          organizationId: principal.organizationId,
          customerId: invoice.customerId,
        },
      });
      if (!payment || !canAccessBranch(principal, payment.branchId))
        throw AppException.notFound('Payment');
      const ok = await allocate(tx, {
        organizationId: principal.organizationId,
        invoiceId,
        paymentId: payment.id,
        amount: new D(input.amount),
        actorUserId: principal.userId,
      }).catch(() => false);
      if (!ok)
        throw AppException.conflict(
          'That amount is more than the payment has available or the invoice still owes.',
        );
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: invoice.branchId,
        actorUserId: principal.userId,
        action: 'invoice.payment_allocated',
        entityType: 'invoice',
        entityId: invoiceId,
        after: { paymentId: payment.id, amount: input.amount },
      });
    });
    return this.get(principal, invoiceId);
  }

  async release(principal: Principal, allocationId: string, reason: string): Promise<Invoice> {
    const invoiceId = await this.prisma.$transaction(async (tx) => {
      const allocation = await tx.paymentAllocation.findFirst({
        where: { id: allocationId, organizationId: principal.organizationId },
      });
      if (!allocation) throw AppException.notFound('Allocation');
      const invoice = await this.invoiceInScope(principal, allocation.invoiceId, tx);
      const released = await releaseAllocation(tx, {
        organizationId: principal.organizationId,
        allocationId,
        actorUserId: principal.userId,
        reason,
      });
      if (!released) throw AppException.conflict('This allocation was already released.');
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: invoice.branchId,
        actorUserId: principal.userId,
        action: 'invoice.allocation_released',
        entityType: 'invoice',
        entityId: invoice.id,
        after: { allocationId, paymentId: released.paymentId, amount: released.amount.toFixed(2) },
        reason,
      });
      return invoice.id;
    });
    return this.get(principal, invoiceId);
  }

  // ------------------------------------------------------------ read

  async get(principal: Principal, id: string): Promise<Invoice> {
    const invoice = await this.invoiceInScope(principal, id);
    const [lines, job, creditNotes, allocations, config] = await Promise.all([
      this.prisma.invoiceLine.findMany({ where: { invoiceId: id }, ...LINE_SELECT }),
      this.prisma.serviceJob.findUniqueOrThrow({
        where: { id: invoice.jobId },
        select: { jobNumber: true },
      }),
      this.prisma.creditNote.findMany({ where: { invoiceId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.paymentAllocation.findMany({
        where: { invoiceId: id },
        orderBy: { createdAt: 'asc' },
        include: { payment: { select: { receiptNumber: true } } },
      }),
      invoice.status === 'DRAFT' ? this.config(principal.organizationId) : Promise.resolve(null),
    ]);
    return toInvoiceDto(
      invoice,
      lines,
      job.jobNumber,
      creditNotes,
      allocations,
      config ? this.blockers(config) : [],
    );
  }

  async forJob(principal: Principal, jobId: string): Promise<Invoice[]> {
    await this.jobInScope(principal, jobId);
    const ids = await this.prisma.invoice.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return Promise.all(ids.map((i) => this.get(principal, i.id)));
  }

  async register(
    principal: Principal,
    q: {
      from?: string | undefined;
      to?: string | undefined;
      status?: string | undefined;
      branchId?: string | undefined;
      page: number;
      pageSize: number;
    },
  ): Promise<Page<InvoiceSummary>> {
    if (q.branchId && !canAccessBranch(principal, q.branchId))
      throw AppException.notFound('Branch');
    const where: Prisma.InvoiceWhereInput = {
      organizationId: principal.organizationId,
      ...branchFilter(principal),
      ...(q.branchId ? { AND: [{ branchId: q.branchId }] } : {}),
      ...(q.status ? { status: q.status as Invoice['status'] } : { status: { not: 'DRAFT' } }),
      ...(q.from || q.to
        ? {
            invoiceDate: {
              ...(q.from ? { gte: new Date(q.from) } : {}),
              ...(q.to ? { lt: new Date(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { job: { select: { jobNumber: true } } },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      items: rows.map((r) => {
        const recipient = r.recipient as unknown as Party;
        const balance = r.total.minus(r.creditedTotal).minus(r.allocatedTotal);
        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          invoiceDate: r.invoiceDate?.toISOString().slice(0, 10) ?? null,
          status: r.status,
          jobId: r.jobId,
          jobNumber: r.job.jobNumber,
          customerName: recipient.name,
          recipientGstin: recipient.gstin,
          taxableTotal: m2(r.taxableTotal),
          taxTotal: m2(r.taxTotal),
          total: m2(r.total),
          creditedTotal: m2(r.creditedTotal),
          balance: m2(balance),
          paymentState: paymentState(r.total, r.creditedTotal, r.allocatedTotal),
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}

export function paymentState(
  total: Decimal,
  credited: Decimal,
  allocated: Decimal,
): Invoice['paymentState'] {
  if (credited.gte(total)) return 'CREDITED';
  const open = total.minus(credited);
  if (allocated.gte(open)) return 'PAID';
  return allocated.gt(0) ? 'PARTLY_PAID' : 'UNPAID';
}

type InvoiceRow = Prisma.InvoiceGetPayload<object>;
type LineRow = Prisma.InvoiceLineGetPayload<object>;
type CreditRow = Prisma.CreditNoteGetPayload<object>;
type AllocationRow = Prisma.PaymentAllocationGetPayload<{
  include: { payment: { select: { receiptNumber: true } } };
}>;

export function toInvoiceDto(
  invoice: InvoiceRow,
  lines: LineRow[],
  jobNumber: string,
  credits: CreditRow[],
  allocations: AllocationRow[],
  blockers: string[],
): Invoice {
  const recipient = invoice.recipient as unknown as Party;
  const supplier = invoice.supplier as unknown as Party | null;
  const balance = invoice.total.minus(invoice.creditedTotal).minus(invoice.allocatedTotal);
  return {
    id: invoice.id,
    jobId: invoice.jobId,
    jobNumber,
    branchId: invoice.branchId,
    customerId: invoice.customerId,
    invoiceNumber: invoice.invoiceNumber,
    financialYear: invoice.financialYear,
    status: invoice.status,
    invoiceDate: invoice.invoiceDate?.toISOString().slice(0, 10) ?? null,
    currency: invoice.currency,
    supplyType: invoice.supplyType,
    placeOfSupply: {
      code: invoice.placeOfSupplyCode,
      name: stateName(invoice.placeOfSupplyCode) ?? '',
    },
    reverseCharge: invoice.reverseCharge,
    supplier,
    recipient,
    lines: lines.map((l) => ({
      id: l.id,
      position: l.position,
      lineType: l.lineType,
      description: l.description,
      hsnSac: l.hsnSac,
      quantity: l.quantity.toString(),
      unit: l.unit,
      unitPrice: m2(l.unitPrice),
      discount: m2(l.discount),
      taxableValue: m2(l.taxableValue),
      taxCategory: l.taxCategory,
      gstRate: l.gstRate.toString(),
      cgstRate: l.cgstRate.toString(),
      sgstRate: l.sgstRate.toString(),
      igstRate: l.igstRate.toString(),
      cgstAmount: m2(l.cgstAmount),
      sgstAmount: m2(l.sgstAmount),
      igstAmount: m2(l.igstAmount),
      lineTotal: m2(l.lineTotal),
      creditedQuantity: l.creditedQuantity.toString(),
    })),
    taxableTotal: m2(invoice.taxableTotal),
    cgstTotal: m2(invoice.cgstTotal),
    sgstTotal: m2(invoice.sgstTotal),
    igstTotal: m2(invoice.igstTotal),
    taxTotal: m2(invoice.taxTotal),
    roundOff: m2(invoice.roundOff),
    total: m2(invoice.total),
    creditedTotal: m2(invoice.creditedTotal),
    paidTotal: m2(invoice.allocatedTotal),
    balance: m2(balance),
    paymentState: paymentState(invoice.total, invoice.creditedTotal, invoice.allocatedTotal),
    amountInWords: amountInWordsINR(m2(invoice.total)),
    notes: invoice.notes,
    rowVersion: invoice.rowVersion,
    issuedAt: invoice.issuedAt?.toISOString() ?? null,
    creditNotes: credits.map((c) => ({
      id: c.id,
      number: c.creditNoteNumber,
      date: c.noteDate.toISOString().slice(0, 10),
      reason: c.reason,
      total: m2(c.total),
    })),
    allocations: allocations.map((a) => ({
      id: a.id,
      paymentId: a.paymentId,
      receiptNumber: a.payment.receiptNumber,
      amount: m2(a.amount),
      createdAt: a.createdAt.toISOString(),
      releasedAt: a.releasedAt?.toISOString() ?? null,
      releaseReason: a.releaseReason,
    })),
    blockers,
  };
}
