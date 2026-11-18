import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_STATUS_BY_JOB_STATUS,
  CUSTOMER_STATUS_LABELS,
  type ChecklistItem,
  type DocumentLink,
  SETTINGS,
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
import { PdfRenderer } from './pdf-renderer.service.js';

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
