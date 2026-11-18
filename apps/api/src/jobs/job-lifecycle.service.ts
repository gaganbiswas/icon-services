import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_STATUS_BY_JOB_STATUS,
  CUSTOMER_STATUS_LABELS,
  type CompletionRequest,
  type DiagnosisRequest,
  type JobDetail,
  type JobStatus,
  type JobWorkspace,
  type ReceiveDeviceRequest,
  type TransitionError,
  type TransitionRequest,
  type WorkLogRequest,
  availableTransitions,
  checkTransition,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import { branchFilter, hasPermission } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { FilesService } from '../files/files.service.js';
import { type NotificationEvent, enqueueNotification } from '../notifications/outbox.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { JOB_DETAIL_SELECT, toJobDetail } from './job.mapper.js';

type Tx = Prisma.TransactionClient;

const TERMINAL: readonly JobStatus[] = ['DELIVERED', 'CANCELLED'];

const TRANSITION_ERRORS: Record<TransitionError, { status: HttpStatus; message: string }> = {
  INVALID_TRANSITION: {
    status: HttpStatus.CONFLICT,
    message: 'This status change is not allowed from the current status',
  },
  REASON_REQUIRED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'A reason is required for this status change',
  },
  FORBIDDEN: {
    status: HttpStatus.FORBIDDEN,
    message: 'You do not have permission to make this status change',
  },
  ESTIMATE_APPROVAL_REQUIRED: {
    status: HttpStatus.CONFLICT,
    message: 'Repair cannot start until the customer has approved an estimate',
  },
  ESTIMATE_REJECTION_REQUIRED: {
    status: HttpStatus.CONFLICT,
    message: 'A device can be returned unrepaired only after the customer rejects the estimate',
  },
  COMPLETION_REQUIRED: {
    status: HttpStatus.CONFLICT,
    message: 'Record the repair summary and quality check to complete the repair',
  },
  USE_DELIVERY_WORKFLOW: {
    status: HttpStatus.CONFLICT,
    message: 'Use the delivery hand-over to mark a job delivered',
  },
  USE_RECEIVE_ACTION: {
    status: HttpStatus.CONFLICT,
    message: 'Use “Receive device” to record the device intake',
  },
};

function transitionError(code: TransitionError): AppException {
  const { status, message } = TRANSITION_ERRORS[code];
  return code === 'FORBIDDEN'
    ? AppException.forbidden(message)
    : new AppException(status, code, message);
}

interface WorkJob {
  id: string;
  organizationId: string;
  branchId: string;
  customerId: string;
  jobNumber: string;
  status: JobStatus;
  version: number;
  completedAt: Date | null;
}

const WORK_JOB_SELECT = {
  id: true,
  organizationId: true,
  branchId: true,
  customerId: true,
  jobNumber: true,
  status: true,
  version: true,
  completedAt: true,
} satisfies Prisma.ServiceJobSelect;

/**
 * The only place job status changes (CLAUDE.md §4.3, ADR 0013). Every change
 * writes status history, audit and (when customer-relevant) an outbox event in
 * one transaction.
 */
@Injectable()
export class JobLifecycleService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly files: FilesService,
  ) {}

  // ------------------------------------------------------------ queries

  private async findJob(
    db: Tx | PrismaClient,
    principal: Principal,
    jobId: string,
  ): Promise<WorkJob> {
    const job = await db.serviceJob.findFirst({
      where: { id: jobId, organizationId: principal.organizationId, ...branchFilter(principal) },
      select: WORK_JOB_SELECT,
    });
    if (!job) throw AppException.notFound('Job');
    return job;
  }

  /** Managers (jobs.assign) work on any job in scope; others only on jobs assigned to them. */
  private async canWork(
    db: Tx | PrismaClient,
    principal: Principal,
    jobId: string,
  ): Promise<boolean> {
    if (hasPermission(principal, 'jobs.assign')) return true;
    const active = await db.jobAssignment.count({
      where: { jobId, technicianUserId: principal.userId, endedAt: null },
    });
    return active > 0;
  }

  private async assertCanWork(db: Tx, principal: Principal, jobId: string): Promise<void> {
    if (!(await this.canWork(db, principal, jobId))) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        'NOT_ASSIGNED',
        'This job is not assigned to you',
      );
    }
  }

  private async heldFrom(db: Tx | PrismaClient, jobId: string): Promise<JobStatus | null> {
    const hold = await db.jobStatusHistory.findFirst({
      where: { jobId, toStatus: 'ON_HOLD' },
      orderBy: { createdAt: 'desc' },
      select: { fromStatus: true },
    });
    return hold?.fromStatus ?? null;
  }

  /** Status of the job's current (highest version, non-draft) estimate (ADR 0014). */
  private async currentEstimateStatus(
    db: Tx | PrismaClient,
    jobId: string,
  ): Promise<string | null> {
    const current = await db.estimate.findFirst({
      where: { jobId, status: { notIn: ['DRAFT', 'WITHDRAWN'] } },
      orderBy: { version: 'desc' },
      select: { status: true },
    });
    return current?.status ?? null;
  }

  async workspace(principal: Principal, jobId: string): Promise<JobWorkspace> {
    const job = await this.findJob(this.prisma, principal, jobId);
    const canSeeInternal = hasPermission(principal, 'jobs.internal_notes.read');
    const [assignments, diagnoses, workLogs, completion, canWork, heldFrom, estimateStatus] =
      await Promise.all([
        this.prisma.jobAssignment.findMany({
          where: { jobId },
          include: { technician: { select: { id: true, fullName: true } } },
          orderBy: { assignedAt: 'asc' },
        }),
        this.prisma.diagnosis.findMany({
          where: { jobId },
          include: { technician: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.workLog.findMany({
          where: { jobId, ...(canSeeInternal ? {} : { visibility: 'CUSTOMER' }) },
          include: { author: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.serviceJob.findUniqueOrThrow({
          where: { id: jobId },
          select: { repairSummary: true, qcChecklist: true, completedAt: true },
        }),
        this.canWork(this.prisma, principal, jobId),
        this.heldFrom(this.prisma, jobId),
        this.currentEstimateStatus(this.prisma, jobId),
      ]);
    return {
      assignments: assignments.map((a) => ({
        id: a.id,
        technician: a.technician,
        assignedAt: a.assignedAt.toISOString(),
        endedAt: a.endedAt?.toISOString() ?? null,
        note: a.note,
      })),
      diagnoses: diagnoses.map((d) => ({
        id: d.id,
        technician: d.technician,
        symptom: d.symptom,
        findings: d.findings,
        rootCause: d.rootCause,
        recommendation: d.recommendation,
        ...(canSeeInternal ? { internalNotes: d.internalNotes } : {}),
        createdAt: d.createdAt.toISOString(),
      })),
      workLogs: workLogs.map((w) => ({
        id: w.id,
        author: w.author,
        description: w.description,
        durationMinutes: w.durationMinutes,
        visibility: w.visibility,
        createdAt: w.createdAt.toISOString(),
      })),
      completion:
        completion.completedAt && completion.repairSummary
          ? {
              repairSummary: completion.repairSummary,
              qcChecklist: completion.qcChecklist as { item: string; passed: boolean }[],
              completedAt: completion.completedAt.toISOString(),
            }
          : null,
      allowedTransitions: canWork
        ? availableTransitions(job.status, {
            permissions: principal.permissions,
            heldFrom,
            hasApprovedEstimate: estimateStatus === 'APPROVED',
            hasRejectedEstimate: estimateStatus === 'REJECTED',
          })
        : [],
      canWork,
      canSeeInternalNotes: canSeeInternal,
    };
  }

  /** Staff who may be assigned: active, technical permission, access to the job's branch. */
  async assignableTechnicians(
    principal: Principal,
    jobId: string,
  ): Promise<{ id: string; fullName: string }[]> {
    const job = await this.findJob(this.prisma, principal, jobId);
    return this.prisma.user.findMany({
      where: {
        organizationId: principal.organizationId,
        isActive: true,
        roles: {
          some: { role: { permissions: { some: { permission: { code: 'worklogs.write' } } } } },
        },
        OR: [
          { branchAccess: { some: { branchId: job.branchId } } },
          {
            roles: {
              some: { role: { permissions: { some: { permission: { code: 'branches.all' } } } } },
            },
          },
        ],
      },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
  }

  // ----------------------------------------------------------- commands

  async transition(
    principal: Principal,
    jobId: string,
    input: TransitionRequest,
  ): Promise<JobDetail> {
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertCanWork(tx, principal, jobId);
      if (job.version !== input.version) throw AppException.versionConflict();
      const error = checkTransition(job.status, input.to, {
        permissions: principal.permissions,
        reason: input.reason,
        heldFrom: job.status === 'ON_HOLD' ? await this.heldFrom(tx, jobId) : null,
        hasApprovedEstimate: (await this.currentEstimateStatus(tx, jobId)) === 'APPROVED',
        hasRejectedEstimate: (await this.currentEstimateStatus(tx, jobId)) === 'REJECTED',
        hasCompletionRecord: job.completedAt !== null,
      });
      if (error) throw transitionError(error);

      const reopening = TERMINAL.includes(job.status);
      await this.applyStatus(tx, principal, job, input.to, {
        reason: input.reason ?? null,
        customerMessage: input.customerMessage ?? null,
        // Reopening clears the completion record in the same statement (CHECK constraint).
        extra: reopening
          ? {
              completedAt: null,
              completedById: null,
              repairSummary: null,
              qcChecklist: Prisma.DbNull,
            }
          : {},
        action: reopening ? 'job.reopened' : 'job.status_changed',
      });
      return this.detail(tx, jobId);
    });
  }

  async receiveDevice(
    principal: Principal,
    jobId: string,
    input: ReceiveDeviceRequest,
  ): Promise<JobDetail> {
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      if (job.version !== input.version) throw AppException.versionConflict();
      if (job.status !== 'AWAITING_DEVICE') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'This job is not waiting for its device',
        );
      }
      await this.files.assertAttachable(
        principal.organizationId,
        { kind: 'user', userId: principal.userId },
        input.attachmentFileIds,
      );
      if (input.attachmentFileIds.length > 0) {
        await tx.jobAttachment.createMany({
          data: [...new Set(input.attachmentFileIds)].map((fileId) => ({
            jobId,
            fileId,
            category: 'INTAKE_PHOTO',
            visibility: 'INTERNAL' as const,
          })),
        });
      }
      const now = new Date();
      await this.applyStatus(tx, principal, job, 'RECEIVED', {
        reason: null,
        customerMessage: null,
        action: 'job.device_received',
        extra: {
          intakeChecklist: input.intakeChecklist,
          accessoriesReceived: input.accessoriesReceived,
          conditionNotes: input.conditionNotes ?? null,
          acknowledgementMethod: input.acknowledgementMethod,
          customerAcknowledgedAt: now,
          receivedAt: now,
          receivedById: principal.userId,
        },
        event: 'JOB_RECEIVED',
      });
      return this.detail(tx, jobId);
    });
  }

  async complete(
    principal: Principal,
    jobId: string,
    input: CompletionRequest,
  ): Promise<JobDetail> {
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertCanWork(tx, principal, jobId);
      if (!hasPermission(principal, 'jobs.transition')) throw AppException.forbidden();
      if (job.version !== input.version) throw AppException.versionConflict();
      if (job.status !== 'QUALITY_CHECK') {
        throw new AppException(
          HttpStatus.CONFLICT,
          'INVALID_TRANSITION',
          'Only jobs in quality check can be completed',
        );
      }
      const failed = input.qcChecklist.filter((c) => !c.passed);
      if (failed.length > 0) {
        throw new AppException(
          HttpStatus.BAD_REQUEST,
          'COMPLETION_REQUIRED',
          'Every quality-check item must pass before completing the repair',
          failed.map((c) => ({ path: 'qcChecklist', message: `Not passed: ${c.item}` })),
        );
      }
      await this.applyStatus(tx, principal, job, 'REPAIR_COMPLETED', {
        reason: null,
        customerMessage: input.customerMessage ?? null,
        action: 'job.repair_completed',
        extra: {
          repairSummary: input.repairSummary,
          qcChecklist: input.qcChecklist,
          completedAt: new Date(),
          completedById: principal.userId,
        },
      });
      return this.detail(tx, jobId);
    });
  }

  async assign(
    principal: Principal,
    jobId: string,
    technicianUserId: string,
    note: string | undefined,
  ): Promise<JobWorkspace> {
    await this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      if (TERMINAL.includes(job.status))
        throw new AppException(HttpStatus.CONFLICT, 'CONFLICT', 'Closed jobs cannot be assigned');
      const technician = await tx.user.findFirst({
        where: { id: technicianUserId, organizationId: principal.organizationId, isActive: true },
        select: {
          id: true,
          fullName: true,
          branchAccess: { select: { branchId: true } },
          roles: {
            select: {
              role: {
                select: { permissions: { select: { permission: { select: { code: true } } } } },
              },
            },
          },
        },
      });
      if (!technician) throw AppException.notFound('Technician');
      const permissions = new Set(
        technician.roles.flatMap((r) => r.role.permissions.map((p) => p.permission.code)),
      );
      const inBranch =
        permissions.has('branches.all') ||
        technician.branchAccess.some((b) => b.branchId === job.branchId);
      if (!permissions.has('worklogs.write') || !inBranch) {
        throw new AppException(
          HttpStatus.CONFLICT,
          'CONFLICT',
          'This user cannot work on jobs in this branch',
        );
      }
      const active = await tx.jobAssignment.count({
        where: { jobId, technicianUserId, endedAt: null },
      });
      if (active > 0) throw AppException.conflict('This technician is already assigned to the job');
      const assignment = await tx.jobAssignment.create({
        data: { jobId, technicianUserId, assignedById: principal.userId, note: note ?? null },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.technician_assigned',
        entityType: 'service_job',
        entityId: jobId,
        after: { assignmentId: assignment.id, technicianUserId, technician: technician.fullName },
      });
    });
    return this.workspace(principal, jobId);
  }

  async endAssignment(
    principal: Principal,
    jobId: string,
    assignmentId: string,
    reason: string,
  ): Promise<JobWorkspace> {
    await this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      const ended = await tx.jobAssignment.updateMany({
        where: { id: assignmentId, jobId, endedAt: null },
        data: { endedAt: new Date(), endedById: principal.userId },
      });
      if (ended.count !== 1) throw AppException.notFound('Assignment');
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.technician_unassigned',
        entityType: 'service_job',
        entityId: jobId,
        after: { assignmentId },
        reason,
      });
    });
    return this.workspace(principal, jobId);
  }

  async addDiagnosis(
    principal: Principal,
    jobId: string,
    input: DiagnosisRequest,
  ): Promise<JobWorkspace> {
    await this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertCanWork(tx, principal, jobId);
      this.assertOpen(job);
      if (input.internalNotes && !hasPermission(principal, 'jobs.internal_notes.write'))
        throw AppException.forbidden();
      const diagnosis = await tx.diagnosis.create({
        data: {
          jobId,
          technicianUserId: principal.userId,
          symptom: input.symptom,
          findings: input.findings,
          rootCause: input.rootCause ?? null,
          recommendation: input.recommendation ?? null,
          internalNotes: input.internalNotes ?? null,
        },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.diagnosis_added',
        entityType: 'service_job',
        entityId: jobId,
        after: { diagnosisId: diagnosis.id, hasInternalNotes: Boolean(input.internalNotes) },
      });
    });
    return this.workspace(principal, jobId);
  }

  async addWorkLog(
    principal: Principal,
    jobId: string,
    input: WorkLogRequest,
  ): Promise<JobWorkspace> {
    await this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertCanWork(tx, principal, jobId);
      this.assertOpen(job);
      if (input.visibility === 'INTERNAL' && !hasPermission(principal, 'jobs.internal_notes.write'))
        throw AppException.forbidden();
      const log = await tx.workLog.create({
        data: {
          jobId,
          authorUserId: principal.userId,
          description: input.description,
          durationMinutes: input.durationMinutes ?? null,
          visibility: input.visibility,
        },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.work_logged',
        entityType: 'service_job',
        entityId: jobId,
        after: {
          workLogId: log.id,
          visibility: input.visibility,
          durationMinutes: input.durationMinutes ?? null,
        },
      });
      if (input.visibility === 'CUSTOMER') {
        await enqueueNotification(tx, {
          organizationId: job.organizationId,
          branchId: job.branchId,
          jobId,
          customerId: job.customerId,
          eventType: 'JOB_UPDATE_POSTED',
          payload: { jobNumber: job.jobNumber, message: input.description },
          dedupeKey: log.id,
        });
      }
    });
    return this.workspace(principal, jobId);
  }

  async addAttachment(
    principal: Principal,
    jobId: string,
    input: { fileId: string; category: string; visibility: 'INTERNAL' | 'CUSTOMER' },
  ): Promise<JobDetail> {
    return this.prisma.$transaction(async (tx) => {
      const job = await this.findJob(tx, principal, jobId);
      await this.assertCanWork(tx, principal, jobId);
      this.assertOpen(job);
      await this.files.assertAttachable(
        principal.organizationId,
        { kind: 'user', userId: principal.userId },
        [input.fileId],
      );
      await tx.jobAttachment.create({
        data: {
          jobId,
          fileId: input.fileId,
          category: input.category,
          visibility: input.visibility,
        },
      });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        branchId: job.branchId,
        actorUserId: principal.userId,
        action: 'job.attachment_added',
        entityType: 'service_job',
        entityId: jobId,
        after: input,
      });
      return this.detail(tx, jobId);
    });
  }

  // ------------------------------------------------------------ helpers

  private assertOpen(job: WorkJob): void {
    if (TERMINAL.includes(job.status)) {
      throw new AppException(
        HttpStatus.CONFLICT,
        'CONFLICT',
        'Closed jobs cannot be changed. Reopen the job first.',
      );
    }
  }

  private async detail(tx: Tx, jobId: string): Promise<JobDetail> {
    return toJobDetail(
      await tx.serviceJob.findUniqueOrThrow({ where: { id: jobId }, select: JOB_DETAIL_SELECT }),
    );
  }

  /** Status change inside an existing transaction (used by estimates). Caller has authorized. */
  async applyStatusInTx(
    tx: Tx,
    principal: Principal,
    jobId: string,
    to: JobStatus,
    options: {
      reason: string | null;
      customerMessage: string | null;
      action: string;
      event?: NotificationEvent;
    },
  ): Promise<void> {
    const job = await this.findJob(tx, principal, jobId);
    await this.applyStatus(tx, principal, job, to, options);
  }

  private async applyStatus(
    tx: Tx,
    principal: Principal,
    job: WorkJob,
    to: JobStatus,
    options: {
      reason: string | null;
      customerMessage: string | null;
      action: string;
      extra?: Prisma.ServiceJobUpdateManyMutationInput;
      event?: NotificationEvent;
    },
  ): Promise<void> {
    const updated = await tx.serviceJob.updateMany({
      where: { id: job.id, version: job.version },
      data: { ...options.extra, status: to, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw AppException.versionConflict();
    const history = await tx.jobStatusHistory.create({
      data: {
        jobId: job.id,
        fromStatus: job.status,
        toStatus: to,
        actorUserId: principal.userId,
        channel: 'STAFF_WEB',
        reason: options.reason,
        customerMessage: options.customerMessage,
      },
    });
    await this.audit.record(tx, {
      organizationId: principal.organizationId,
      branchId: job.branchId,
      actorUserId: principal.userId,
      action: options.action,
      entityType: 'service_job',
      entityId: job.id,
      before: { status: job.status, version: job.version },
      after: { status: to, version: job.version + 1 },
      reason: options.reason,
    });

    const before = CUSTOMER_STATUS_BY_JOB_STATUS[job.status];
    const after = CUSTOMER_STATUS_BY_JOB_STATUS[to];
    const event: NotificationEvent | null =
      options.event ??
      (to === 'REPAIR_COMPLETED'
        ? 'REPAIR_COMPLETED'
        : to === 'READY_FOR_DELIVERY'
          ? 'READY_FOR_DELIVERY'
          : before !== after || options.customerMessage
            ? 'JOB_STATUS_CHANGED'
            : null);
    if (event) {
      await enqueueNotification(tx, {
        organizationId: job.organizationId,
        branchId: job.branchId,
        jobId: job.id,
        customerId: job.customerId,
        eventType: event,
        payload: {
          jobNumber: job.jobNumber,
          statusLabel: CUSTOMER_STATUS_LABELS[after],
          message: options.customerMessage,
        },
        dedupeKey: history.id,
      });
    }
  }
}
