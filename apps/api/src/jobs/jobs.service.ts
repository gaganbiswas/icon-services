import { Inject, Injectable } from '@nestjs/common';
import type {
  Address,
  CreateJobRequest,
  JobDetail,
  JobSummary,
  Page,
  PaginationQuery,
} from '@icon/contracts';
import type { $Enums, Prisma, PrismaClient } from '@icon/database';

import { branchFilter, canAccessBranch } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { FilesService, type Uploader } from '../files/files.service.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JOB_DETAIL_SELECT, JOB_SUMMARY_SELECT, toJobDetail, toJobSummary } from './job.mapper.js';

type Tx = Prisma.TransactionClient;

export interface NewJob {
  readonly organizationId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly assetId: string;
  readonly serviceType: $Enums.ServiceType;
  readonly serviceMode: $Enums.ServiceMode;
  readonly complaint: string;
  readonly intakeChecklist: CreateJobRequest['intakeChecklist'];
  readonly accessoriesReceived: string[];
  readonly conditionNotes?: string | undefined;
  readonly serviceAddress?: Address | undefined;
  readonly expectedCompletionDate?: string | undefined;
  readonly acknowledgementMethod?: string | undefined;
  readonly channel: $Enums.IntakeChannel;
  readonly status: 'RECEIVED' | 'AWAITING_DEVICE';
  readonly createdBy: { userId: string } | { customerId: string };
  readonly attachments: {
    fileIds: readonly string[];
    category: string;
    visibility: 'INTERNAL' | 'CUSTOMER';
  };
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  private scope(principal: Principal): Prisma.ServiceJobWhereInput {
    return { organizationId: principal.organizationId, ...branchFilter(principal) };
  }

  /** Staff intake (CLAUDE.md §4.2) — idempotent by Idempotency-Key. */
  async createFromStaff(
    principal: Principal,
    input: CreateJobRequest,
    idempotencyKey: string,
  ): Promise<{ status: number; body: JobDetail; replayed: boolean }> {
    if (!canAccessBranch(principal, input.branchId)) {
      throw AppException.notFound('Branch');
    }
    const uploader: Uploader = { kind: 'user', userId: principal.userId };
    return this.prisma.$transaction(
      (tx) =>
        runIdempotent<JobDetail>(
          tx,
          {
            organizationId: principal.organizationId,
            actorKey: `user:${principal.userId}`,
            operation: 'jobs.create',
          },
          idempotencyKey,
          input,
          async () => {
            await this.files.assertAttachable(
              principal.organizationId,
              uploader,
              input.attachmentFileIds,
            );
            const job = await this.createInTx(tx, {
              organizationId: principal.organizationId,
              branchId: input.branchId,
              customerId: input.customerId,
              assetId: input.assetId,
              serviceType: input.serviceType,
              serviceMode: input.serviceMode,
              complaint: input.complaint,
              intakeChecklist: input.intakeChecklist,
              accessoriesReceived: input.accessoriesReceived,
              conditionNotes: input.conditionNotes,
              serviceAddress: input.serviceAddress,
              expectedCompletionDate: input.expectedCompletionDate,
              acknowledgementMethod: input.acknowledgementMethod,
              channel: 'STAFF',
              status: 'RECEIVED',
              createdBy: { userId: principal.userId },
              attachments: {
                fileIds: input.attachmentFileIds,
                category: 'INTAKE_PHOTO',
                visibility: 'INTERNAL',
              },
            });
            return { status: 201, body: job, resourceId: job.id };
          },
        ),
      { timeout: 15_000 },
    );
  }

  /** Creates the job, its number, initial status history and attachments in one transaction. */
  async createInTx(tx: Tx, input: NewJob): Promise<JobDetail> {
    const [branch, customer, asset] = await Promise.all([
      tx.branch.findFirst({
        where: { id: input.branchId, organizationId: input.organizationId, isActive: true },
        select: {
          id: true,
          code: true,
          timezone: true,
          organization: { select: { timezone: true } },
        },
      }),
      tx.customer.findFirst({
        where: { id: input.customerId, organizationId: input.organizationId, status: 'ACTIVE' },
        select: { id: true },
      }),
      tx.asset.findFirst({
        where: { id: input.assetId, organizationId: input.organizationId, isActive: true },
        select: { id: true, customerId: true },
      }),
    ]);
    if (!branch) throw AppException.notFound('Branch');
    if (!customer) throw AppException.notFound('Customer');
    if (!asset || asset.customerId !== customer.id) throw AppException.notFound('Device');

    const format = await this.settings.get(input.organizationId, 'numbering.jobNumber', tx);
    const now = new Date();
    const jobNumber = await this.numbering.next(tx, {
      organizationId: input.organizationId,
      branch: { id: branch.id, code: branch.code },
      documentType: 'SERVICE_JOB',
      format,
      timeZone: branch.timezone ?? branch.organization.timezone,
      at: now,
    });
    const userId = 'userId' in input.createdBy ? input.createdBy.userId : null;
    const customerId = 'customerId' in input.createdBy ? input.createdBy.customerId : null;

    const job = await tx.serviceJob.create({
      data: {
        organizationId: input.organizationId,
        branchId: branch.id,
        jobNumber,
        customerId: customer.id,
        assetId: asset.id,
        serviceType: input.serviceType,
        serviceMode: input.serviceMode,
        complaint: input.complaint,
        intakeChecklist: input.intakeChecklist,
        accessoriesReceived: input.accessoriesReceived,
        conditionNotes: input.conditionNotes ?? null,
        serviceAddress: input.serviceAddress,
        channel: input.channel,
        status: input.status,
        receivedAt: input.status === 'RECEIVED' ? now : null,
        receivedById: input.status === 'RECEIVED' ? userId : null,
        expectedCompletionDate: input.expectedCompletionDate
          ? new Date(`${input.expectedCompletionDate}T00:00:00Z`)
          : null,
        customerAcknowledgedAt: input.acknowledgementMethod || customerId ? now : null,
        acknowledgementMethod: customerId
          ? 'APP_SUBMISSION'
          : (input.acknowledgementMethod ?? null),
        createdById: userId,
        createdByCustomerId: customerId,
      },
      select: { id: true },
    });
    await tx.jobStatusHistory.create({
      data: {
        jobId: job.id,
        fromStatus: null,
        toStatus: input.status,
        actorUserId: userId,
        actorCustomerId: customerId,
        channel: input.channel === 'STAFF' ? 'STAFF_WEB' : input.channel,
      },
    });
    if (input.attachments.fileIds.length > 0) {
      await tx.jobAttachment.createMany({
        data: [...new Set(input.attachments.fileIds)].map((fileId) => ({
          jobId: job.id,
          fileId,
          category: input.attachments.category,
          visibility: input.attachments.visibility,
        })),
      });
    }
    await this.audit.record(tx, {
      organizationId: input.organizationId,
      branchId: branch.id,
      actorUserId: userId,
      actorType: userId ? 'USER' : 'ANONYMOUS',
      action: 'job.created',
      entityType: 'service_job',
      entityId: job.id,
      after: {
        jobNumber,
        channel: input.channel,
        status: input.status,
        customerId: customer.id,
        assetId: asset.id,
        serviceType: input.serviceType,
        serviceMode: input.serviceMode,
        createdByCustomerId: customerId,
      },
    });
    const row = await tx.serviceJob.findUniqueOrThrow({
      where: { id: job.id },
      select: JOB_DETAIL_SELECT,
    });
    return toJobDetail(row);
  }

  async list(
    principal: Principal,
    query: PaginationQuery & {
      q?: string | undefined;
      status?: $Enums.JobStatus | undefined;
      branchId?: string | undefined;
      customerId?: string | undefined;
    },
  ): Promise<Page<JobSummary>> {
    const where: Prisma.ServiceJobWhereInput = {
      ...this.scope(principal),
      ...(query.status ? { status: query.status } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    };
    if (query.branchId) {
      where.AND = [{ branchId: query.branchId }];
    }
    if (query.q) {
      const q = query.q;
      const digits = q.replace(/[^\d]/g, '');
      where.OR = [
        { jobNumber: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { asset: { serialNumber: { contains: q, mode: 'insensitive' } } },
        ...(digits.length >= 4 ? [{ customer: { phoneE164: { contains: digits } } }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.serviceJob.findMany({
        where,
        select: JOB_SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.serviceJob.count({ where }),
    ]);
    return { items: rows.map(toJobSummary), page: query.page, pageSize: query.pageSize, total };
  }

  async get(principal: Principal, id: string): Promise<JobDetail> {
    const row = await this.prisma.serviceJob.findFirst({
      where: { id, ...this.scope(principal) },
      select: JOB_DETAIL_SELECT,
    });
    if (!row) throw AppException.notFound('Job');
    return toJobDetail(row);
  }
}
