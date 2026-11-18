import { Inject, Injectable } from '@nestjs/common';
import type { CustomerComplaintRequest, CustomerJob } from '@icon/contracts';
import type { PrismaClient } from '@icon/database';

import { AssetsService } from '../assets/assets.service.js';
import { AppException } from '../common/app-exception.js';
import type { CustomerPrincipal } from '../customer-auth/customer-principal.js';
import { FilesService } from '../files/files.service.js';
import { runIdempotent } from '../idempotency/idempotency.service.js';
import { CUSTOMER_JOB_SELECT, toCustomerJob } from '../jobs/job.mapper.js';
import { JobsService } from '../jobs/jobs.service.js';
import { PRISMA } from '../prisma/prisma.service.js';

const WARRANTY_CLAIM_NOTES = {
  IN_WARRANTY: 'Customer reports the device is in warranty (not verified).',
  OUT_OF_WARRANTY: 'Customer reports the device is out of warranty.',
  NOT_SURE: 'Customer is not sure about warranty.',
} as const;

@Injectable()
export class CustomerPortalService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly jobs: JobsService,
    private readonly assets: AssetsService,
    private readonly files: FilesService,
  ) {}

  async listJobs(me: CustomerPrincipal): Promise<CustomerJob[]> {
    const rows = await this.prisma.serviceJob.findMany({
      where: { organizationId: me.organizationId, customerId: me.customerId },
      select: CUSTOMER_JOB_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map(toCustomerJob);
  }

  async getJob(me: CustomerPrincipal, id: string): Promise<CustomerJob> {
    const row = await this.prisma.serviceJob.findFirst({
      where: { id, organizationId: me.organizationId, customerId: me.customerId },
      select: CUSTOMER_JOB_SELECT,
    });
    if (!row) throw AppException.notFound('Job');
    return toCustomerJob(row);
  }

  /** Customer-submitted complaint → job in AWAITING_DEVICE (ADR 0012). */
  async submitComplaint(
    me: CustomerPrincipal,
    input: CustomerComplaintRequest,
    idempotencyKey: string,
  ): Promise<{ status: number; body: CustomerJob; replayed: boolean }> {
    const uploader = { kind: 'customer' as const, customerId: me.customerId };
    return this.prisma.$transaction(
      (tx) =>
        runIdempotent<CustomerJob>(
          tx,
          {
            organizationId: me.organizationId,
            actorKey: `customer:${me.customerId}`,
            operation: 'customer.jobs.create',
          },
          idempotencyKey,
          input,
          async () => {
            await this.files.assertAttachable(me.organizationId, uploader, input.photoFileIds);
            let assetId = input.assetId;
            if (assetId) {
              const owned = await tx.asset.count({
                where: {
                  id: assetId,
                  organizationId: me.organizationId,
                  customerId: me.customerId,
                  isActive: true,
                },
              });
              if (owned !== 1) throw AppException.notFound('Device');
            } else if (input.newAsset) {
              const created = await this.assets.createInTx(
                tx,
                { organizationId: me.organizationId, userId: null },
                {
                  customerId: me.customerId,
                  categoryId: input.newAsset.categoryId,
                  brand: input.newAsset.brand,
                  model: input.newAsset.model,
                  serialNumber: input.newAsset.serialNumber,
                  attributes: {},
                },
              );
              assetId = created.asset.id;
            }
            if (!assetId) throw AppException.notFound('Device');

            const job = await this.jobs.createInTx(tx, {
              organizationId: me.organizationId,
              branchId: input.branchId,
              customerId: me.customerId,
              assetId,
              // Customers' warranty claims are never trusted until staff verify them.
              serviceType:
                input.warrantyClaim === 'OUT_OF_WARRANTY'
                  ? 'OUT_OF_WARRANTY'
                  : 'WARRANTY_UNVERIFIED',
              serviceMode: input.serviceMode,
              complaint: input.complaint,
              intakeChecklist: [],
              accessoriesReceived: input.accessories,
              conditionNotes: undefined,
              serviceAddress: input.serviceAddress,
              channel: 'CUSTOMER_APP',
              status: 'AWAITING_DEVICE',
              createdBy: { customerId: me.customerId },
              attachments: {
                fileIds: input.photoFileIds,
                category: 'CUSTOMER_PHOTO',
                visibility: 'CUSTOMER',
              },
            });
            await tx.serviceJob.update({
              where: { id: job.id },
              data: { warrantyNotes: WARRANTY_CLAIM_NOTES[input.warrantyClaim] },
            });
            const row = await tx.serviceJob.findUniqueOrThrow({
              where: { id: job.id },
              select: CUSTOMER_JOB_SELECT,
            });
            return { status: 201, body: toCustomerJob(row), resourceId: job.id };
          },
        ),
      { timeout: 15_000 },
    );
  }
}
