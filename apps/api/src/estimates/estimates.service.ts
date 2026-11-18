import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type CustomerEstimate,
  type Estimate,
  type EstimateDecisionRequest,
  type EstimateDraft,
  type SentEstimateResponse,
  TAX_NOT_CONFIGURED_NOTE,
  computeLine,
  computeTotals,
} from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import { branchFilter, hasPermission } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { generateOpaqueToken, hashToken } from '../auth/token.service.js';
import { AppException } from '../common/app-exception.js';
import { currentRequestContext } from '../common/request-context.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { JobLifecycleService } from '../jobs/job-lifecycle.service.js';
import { enqueueNotification } from '../notifications/outbox.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;
const MAX_LINK_DAYS = 14;

const ESTIMATE_INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  decision: true,
} satisfies Prisma.EstimateInclude;

type EstimateRow = Prisma.EstimateGetPayload<{ include: typeof ESTIMATE_INCLUDE }>;

const money = (d: Prisma.Decimal) => d.toFixed(4);
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

export function isExpired(
  row: { status: string; validUntil: Date | null },
  now = new Date(),
): boolean {
  // validUntil is inclusive (whole day, UTC until the business time zone is confirmed).
  return (
    row.status === 'SENT' &&
    row.validUntil !== null &&
    row.validUntil.getTime() + DAY_MS <= now.getTime()
  );
}

function toEstimateDto(row: EstimateRow): Estimate {
  return {
    id: row.id,
    jobId: row.jobId,
    version: row.version,
    status: row.status,
    expired: isExpired(row),
    currency: row.currency,
    subtotal: money(row.subtotal),
    discountTotal: money(row.discountTotal),
    total: money(row.total),
    customerPayable: money(row.customerPayable),
    covered: money(row.covered),
    taxNote: TAX_NOT_CONFIGURED_NOTE,
    validUntil: isoDate(row.validUntil),
    terms: row.terms,
    notes: row.notes,
    lines: row.lines.map((l) => ({
      id: l.id,
      position: l.position,
      lineType: l.lineType,
      description: l.description,
      sku: l.sku,
      quantity: money(l.quantity),
      unit: l.unit,
      unitPrice: money(l.unitPrice),
      discount: money(l.discount),
      coverage: l.coverage,
      lineTotal: money(l.lineTotal),
    })),
    sentAt: row.sentAt?.toISOString() ?? null,
    decision: row.decision
      ? {
          decision: row.decision.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
          method: row.decision.method,
          comment: row.decision.comment,
          decidedAt: row.decision.createdAt.toISOString(),
        }
      : null,
    rowVersion: row.rowVersion,
  };
}

/** Server-side pricing: totals are never taken from the client (ADR 0014). */
function price(draft: EstimateDraft) {
  const problems: { path: string; message: string }[] = [];
  const lines = draft.lines.map((line, index) => {
    const amounts = computeLine(line);
    if (!amounts) {
      problems.push({
        path: `lines.${index}`,
        message:
          'Check quantity, price and discount: the discount cannot exceed the line, and quantity × price must have at most 4 decimals',
      });
    }
    return { ...line, lineTotal: amounts?.net ?? '0' };
  });
  const totals = problems.length === 0 ? computeTotals(draft.lines) : null;
  if (!totals) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      'VALIDATION_FAILED',
      'The estimate lines are invalid',
      problems.length ? problems : [{ path: 'lines', message: 'The estimate total is too large' }],
    );
  }
  return { lines, totals };
}

@Injectable()
export class EstimatesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_ENV) private readonly env: Env,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly lifecycle: JobLifecycleService,
  ) {}

  // ------------------------------------------------------------- access

  private async findJob(db: Tx | PrismaClient, principal: Principal, jobId: string) {
    const job = await db.serviceJob.findFirst({
      where: { id: jobId, organizationId: principal.organizationId, ...branchFilter(principal) },
      select: {
        id: true,
        organizationId: true,
        branchId: true,
        customerId: true,
        jobNumber: true,
        status: true,
      },
    });
    if (!job) throw AppException.notFound('Job');
    return job;
  }

  private async findEstimate(
    db: Tx | PrismaClient,
    principal: Principal,
    estimateId: string,
  ): Promise<EstimateRow> {
    const row = await db.estimate.findFirst({
      where: {
        id: estimateId,
        organizationId: principal.organizationId,
        ...branchFilter(principal),
      },
      include: ESTIMATE_INCLUDE,
    });
    if (!row) throw AppException.notFound('Estimate');
    return row;
  }

  /** Technical staff (worklogs.write) must be assigned unless they manage assignments. */
  private async assertMayPrepare(db: Tx, principal: Principal, jobId: string): Promise<void> {
    if (!hasPermission(principal, 'worklogs.write') || hasPermission(principal, 'jobs.assign'))
      return;
    const assigned = await db.jobAssignment.count({
      where: { jobId, technicianUserId: principal.userId, endedAt: null },
    });
    if (assigned === 0)
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'NOT_ASSIGNED',
        'This job is not assigned to you',
      );
  }

  private async currency(organizationId: string, db: Tx): Promise<string> {
    const { currency } = await this.settings.get(organizationId, 'money', db);
    if (!currency) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'CONFIGURATION_REQUIRED',
        'Set the business currency in settings before preparing estimates',
      );
    }
    return currency;
  }

  // ------------------------------------------------------------ staff

  async config(organizationId: string): Promise<{ currency: string | null; validityDays: number }> {
    const [{ currency }, { validityDays }] = await Promise.all([
      this.settings.get(organizationId, 'money'),
      this.settings.get(organizationId, 'estimates'),
    ]);
    return { currency, validityDays };
  }

  async listForJob(principal: Principal, jobId: string): Promise<Estimate[]> {
    await this.findJob(this.prisma, principal, jobId);
    const rows = await this.prisma.estimate.findMany({
      where: { jobId },
      include: ESTIMATE_INCLUDE,
      orderBy: { version: 'desc' },
    });
    return rows.map(toEstimateDto);
  }

  async get(principal: Principal, id: string): Promise<Estimate> {
    return toEstimateDto(await this.findEstimate(this.prisma, principal, id));
  }

  async createDraft(principal: Principal, jobId: string, draft: EstimateDraft): Promise<Estimate> {
    const { lines, totals } = price(draft);
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertMayPrepare(tx, principal, jobId);
      if (job.status !== 'ESTIMATE_PREPARATION') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'Move the job to “Estimate preparation” first',
        );
      }
      const currency = await this.currency(job.organizationId, tx);
      const open = await tx.estimate.findFirst({
        where: { jobId, status: { in: ['DRAFT', 'SENT'] } },
      });
      if (open?.status === 'DRAFT')
        throw AppException.conflict('A draft estimate already exists for this job');
      if (open?.status === 'SENT') {
        // Starting a revision supersedes the sent version and its links.
        await tx.estimate.update({
          where: { id: open.id },
          data: { status: 'SUPERSEDED', rowVersion: { increment: 1 } },
        });
        await tx.estimateApprovalLink.updateMany({
          where: { estimateId: open.id, usedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const last = await tx.estimate.findFirst({
        where: { jobId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const { terms } = await this.settings.get(job.organizationId, 'estimates', tx);
      const created = await tx.estimate.create({
        data: {
          organizationId: job.organizationId,
          branchId: job.branchId,
          jobId,
          version: (last?.version ?? 0) + 1,
          currency,
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          total: totals.total,
          customerPayable: totals.customerPayable,
          covered: totals.covered,
          terms,
          notes: draft.notes ?? null,
          preparedById: principal.userId,
        },
      });
      await this.writeLines(tx, created.id, lines);
      await this.audit.record(tx, {
        organizationId: job.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'estimate.draft_created',
        entityType: 'estimate',
        entityId: created.id,
        after: {
          jobId,
          version: created.version,
          ...totals,
          supersededEstimateId: open?.status === 'SENT' ? open.id : null,
        },
      });
      return toEstimateDto(
        await tx.estimate.findUniqueOrThrow({
          where: { id: created.id },
          include: ESTIMATE_INCLUDE,
        }),
      );
    });
  }

  async updateDraft(
    principal: Principal,
    id: string,
    draft: EstimateDraft,
    rowVersion: number,
  ): Promise<Estimate> {
    const { lines, totals } = price(draft);
    return this.prisma.$transaction(async (tx) => {
      const row = await this.findEstimate(tx, principal, id);
      await this.assertMayPrepare(tx, principal, row.jobId);
      if (row.status !== 'DRAFT') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'ESTIMATE_NOT_EDITABLE',
          'Sent estimates cannot be changed. Create a new version.',
        );
      }
      const updated = await tx.estimate.updateMany({
        where: { id, status: 'DRAFT', rowVersion },
        data: {
          subtotal: totals.subtotal,
          discountTotal: totals.discountTotal,
          total: totals.total,
          customerPayable: totals.customerPayable,
          covered: totals.covered,
          notes: draft.notes ?? null,
          rowVersion: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw AppException.versionConflict();
      await tx.estimateLine.deleteMany({ where: { estimateId: id } });
      await this.writeLines(tx, id, lines);
      await this.audit.record(tx, {
        organizationId: row.organizationId,
        branchId: row.branchId,
        actorUserId: principal.userId,
        action: 'estimate.draft_updated',
        entityType: 'estimate',
        entityId: id,
        before: { customerPayable: money(row.customerPayable), lineCount: row.lines.length },
        after: { customerPayable: totals.customerPayable, lineCount: lines.length },
      });
      return toEstimateDto(
        await tx.estimate.findUniqueOrThrow({ where: { id }, include: ESTIMATE_INCLUDE }),
      );
    });
  }

  async send(principal: Principal, id: string, rowVersion: number): Promise<SentEstimateResponse> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.findEstimate(tx, principal, id);
      if (row.status !== 'DRAFT')
        throw new AppException(
          HttpStatus.CONFLICT,
          'ESTIMATE_NOT_EDITABLE',
          'This estimate was already sent',
        );
      const job = await this.findJob(tx, principal, row.jobId);
      if (job.status !== 'ESTIMATE_PREPARATION') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'The job is not in estimate preparation',
        );
      }
      const { validityDays, terms } = await this.settings.get(row.organizationId, 'estimates', tx);
      const validUntil = new Date(todayUtc().getTime() + validityDays * DAY_MS);
      const now = new Date();
      const sent = await tx.estimate.updateMany({
        where: { id, status: 'DRAFT', rowVersion },
        data: {
          status: 'SENT',
          sentAt: now,
          sentById: principal.userId,
          validUntil,
          terms,
          rowVersion: { increment: 1 },
        },
      });
      if (sent.count !== 1) throw AppException.versionConflict();
      const link = await this.createLink(tx, id, validUntil, principal.userId);

      await this.lifecycle.applyStatusInTx(tx, principal, job.id, 'AWAITING_CUSTOMER_APPROVAL', {
        reason: null,
        customerMessage: null,
        action: 'job.status_changed',
        event: 'ESTIMATE_READY',
      });
      await this.audit.record(tx, {
        organizationId: row.organizationId,
        branchId: row.branchId,
        actorUserId: principal.userId,
        action: 'estimate.sent',
        entityType: 'estimate',
        entityId: id,
        after: {
          version: row.version,
          customerPayable: money(row.customerPayable),
          currency: row.currency,
          validUntil: isoDate(validUntil),
        },
      });
      const estimate = toEstimateDto(
        await tx.estimate.findUniqueOrThrow({ where: { id }, include: ESTIMATE_INCLUDE }),
      );
      return { estimate, approvalLink: link };
    });
  }

  /** New single-use link for a sent estimate (previous unused links are revoked). */
  async reissueLink(
    principal: Principal,
    id: string,
  ): Promise<{ token: string; expiresAt: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.findEstimate(tx, principal, id);
      if (row.status !== 'SENT' || isExpired(row) || !row.validUntil) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'ESTIMATE_ALREADY_DECIDED',
          'Links can be issued only for open, unexpired estimates',
        );
      }
      await tx.estimateApprovalLink.updateMany({
        where: { estimateId: id, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const link = await this.createLink(tx, id, row.validUntil, principal.userId);
      await this.audit.record(tx, {
        organizationId: row.organizationId,
        branchId: row.branchId,
        actorUserId: principal.userId,
        action: 'estimate.link_issued',
        entityType: 'estimate',
        entityId: id,
        after: { expiresAt: link.expiresAt },
      });
      return link;
    });
  }

  // --------------------------------------------------------- customer

  async listForCustomer(
    organizationId: string,
    customerId: string,
    jobId: string,
  ): Promise<CustomerEstimate[]> {
    const job = await this.prisma.serviceJob.findFirst({
      where: { id: jobId, organizationId, customerId },
      select: { id: true },
    });
    if (!job) throw AppException.notFound('Job');
    const rows = await this.prisma.estimate.findMany({
      where: { jobId, status: { in: ['SENT', 'APPROVED', 'REJECTED', 'SUPERSEDED'] } },
      include: ESTIMATE_INCLUDE,
      orderBy: { version: 'desc' },
    });
    return Promise.all(rows.map((r) => this.toCustomerEstimate(r)));
  }

  async customerDecision(
    organizationId: string,
    customerId: string,
    estimateId: string,
    input: EstimateDecisionRequest,
  ): Promise<CustomerEstimate> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.estimate.findFirst({
        where: { id: estimateId, organizationId, job: { customerId } },
        include: ESTIMATE_INCLUDE,
      });
      if (!row) throw AppException.notFound('Estimate');
      await this.decide(tx, row, customerId, input, 'CUSTOMER_APP');
      return this.toCustomerEstimate(
        await tx.estimate.findUniqueOrThrow({
          where: { id: estimateId },
          include: ESTIMATE_INCLUDE,
        }),
        tx,
      );
    });
  }

  /** Public view through a link (does not consume it). */
  async resolveLink(token: string): Promise<CustomerEstimate> {
    const link = await this.validLink(this.prisma, token);
    return this.toCustomerEstimate(link.estimate);
  }

  async linkDecision(token: string, input: EstimateDecisionRequest): Promise<CustomerEstimate> {
    return this.prisma.$transaction(async (tx) => {
      const link = await this.validLink(tx, token);
      const consumed = await tx.estimateApprovalLink.updateMany({
        where: { id: link.id, usedAt: null, revokedAt: null },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) throw this.invalidLink();
      const job = await tx.serviceJob.findUniqueOrThrow({
        where: { id: link.estimate.jobId },
        select: { customerId: true },
      });
      await this.decide(tx, link.estimate, job.customerId, input, 'APPROVAL_LINK');
      return this.toCustomerEstimate(
        await tx.estimate.findUniqueOrThrow({
          where: { id: link.estimate.id },
          include: ESTIMATE_INCLUDE,
        }),
        tx,
      );
    });
  }

  // ---------------------------------------------------------- helpers

  private async decide(
    tx: Tx,
    row: EstimateRow,
    customerId: string,
    input: EstimateDecisionRequest,
    method: 'CUSTOMER_APP' | 'APPROVAL_LINK',
  ): Promise<void> {
    if (row.status !== 'SENT') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ESTIMATE_ALREADY_DECIDED',
        'This estimate is no longer open for a decision',
      );
    }
    if (isExpired(row)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ESTIMATE_EXPIRED',
        'This estimate has expired. Please contact the service centre.',
      );
    }
    const job = await tx.serviceJob.findUniqueOrThrow({
      where: { id: row.jobId },
      select: {
        status: true,
        customerId: true,
        branchId: true,
        organizationId: true,
        jobNumber: true,
      },
    });
    if (job.customerId !== customerId) throw AppException.notFound('Estimate');
    if (job.status !== 'AWAITING_CUSTOMER_APPROVAL') {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ESTIMATE_ALREADY_DECIDED',
        'This estimate is no longer open for a decision',
      );
    }
    const now = new Date();
    const claimed = await tx.estimate.updateMany({
      where: { id: row.id, status: 'SENT' },
      data: { status: input.decision, decidedAt: now, rowVersion: { increment: 1 } },
    });
    if (claimed.count !== 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'ESTIMATE_ALREADY_DECIDED',
        'This estimate is no longer open for a decision',
      );
    }
    const context = currentRequestContext();
    const storeClient = this.env.AUDIT_STORE_CLIENT_METADATA;
    await tx.estimateDecision.create({
      data: {
        estimateId: row.id,
        decision: input.decision,
        method,
        customerId,
        estimateVersion: row.version,
        customerPayable: row.customerPayable,
        termsAccepted: input.termsAccepted,
        termsHash: createHash('sha256').update(row.terms, 'utf8').digest('hex'),
        comment: input.comment ?? null,
        ipAddress: storeClient ? context.ipAddress : null,
        userAgent: storeClient ? context.userAgent : null,
      },
    });
    // Any remaining links for this estimate are no longer usable.
    await tx.estimateApprovalLink.updateMany({
      where: { estimateId: row.id, usedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.audit.record(tx, {
      organizationId: job.organizationId,
      branchId: job.branchId,
      actorUserId: null,
      action: input.decision === 'APPROVED' ? 'estimate.approved' : 'estimate.rejected',
      entityType: 'estimate',
      entityId: row.id,
      after: {
        customerId,
        method,
        version: row.version,
        customerPayable: money(row.customerPayable),
        currency: row.currency,
      },
    });
    await enqueueNotification(tx, {
      organizationId: job.organizationId,
      branchId: job.branchId,
      jobId: row.jobId,
      customerId,
      eventType: 'ESTIMATE_DECISION_RECORDED',
      payload: {
        jobNumber: job.jobNumber,
        decision: input.decision,
        estimateVersion: String(row.version),
      },
      dedupeKey: row.id,
    });
  }

  private invalidLink(): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      'INVALID_TOKEN',
      'This link is invalid, already used or expired. Please contact the service centre.',
    );
  }

  private async validLink(db: Tx | PrismaClient, token: string) {
    const link = await db.estimateApprovalLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { estimate: { include: ESTIMATE_INCLUDE } },
    });
    if (!link || link.usedAt || link.revokedAt || link.expiresAt <= new Date())
      throw this.invalidLink();
    return link;
  }

  private async createLink(
    tx: Tx,
    estimateId: string,
    validUntil: Date,
    userId: string,
  ): Promise<{ token: string; expiresAt: string }> {
    const token = generateOpaqueToken();
    const expiresAt = new Date(
      Math.min(validUntil.getTime() + DAY_MS, Date.now() + MAX_LINK_DAYS * DAY_MS),
    );
    await tx.estimateApprovalLink.create({
      data: { estimateId, tokenHash: hashToken(token), expiresAt, createdById: userId },
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  private async writeLines(
    tx: Tx,
    estimateId: string,
    lines: ReturnType<typeof price>['lines'],
  ): Promise<void> {
    await tx.estimateLine.createMany({
      data: lines.map((l, index) => ({
        estimateId,
        position: index + 1,
        lineType: l.lineType,
        description: l.description,
        sku: l.sku ?? null,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discount: l.discount,
        coverage: l.coverage,
        lineTotal: l.lineTotal,
      })),
    });
  }

  private async toCustomerEstimate(
    row: EstimateRow,
    db: Tx | PrismaClient = this.prisma,
  ): Promise<CustomerEstimate> {
    const job = await db.serviceJob.findUniqueOrThrow({
      where: { id: row.jobId },
      select: {
        jobNumber: true,
        organization: { select: { displayName: true } },
        asset: { select: { brand: true, model: true, category: { select: { name: true } } } },
      },
    });
    const { rowVersion: _rowVersion, jobId: _jobId, ...dto } = toEstimateDto(row);
    return {
      ...dto,
      jobNumber: job.jobNumber,
      businessName: job.organization.displayName,
      device: `${job.asset.category.name}: ${job.asset.brand} ${job.asset.model}`,
    };
  }
}
