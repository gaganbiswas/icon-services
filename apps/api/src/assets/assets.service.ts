import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type Asset,
  type AssetCategory,
  type CreateAssetRequest,
  type CreatedAssetResponse,
  attributeSchemaFor,
  normalizeSerial,
} from '@icon/contracts';
import type { Prisma, PrismaClient } from '@icon/database';

import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { PRISMA } from '../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;

export const ASSET_SELECT = {
  id: true,
  customerId: true,
  brand: true,
  model: true,
  serialNumber: true,
  assetTag: true,
  purchaseDate: true,
  warrantyStart: true,
  warrantyEnd: true,
  warrantyProvider: true,
  warrantyReference: true,
  proofOfPurchaseFileId: true,
  attributes: true,
  version: true,
  createdAt: true,
  category: { select: { id: true, code: true, name: true } },
} satisfies Prisma.AssetSelect;

type AssetRow = Prisma.AssetGetPayload<{ select: typeof ASSET_SELECT }>;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null);

export function toAssetDto(row: AssetRow): Asset {
  return {
    id: row.id,
    customerId: row.customerId,
    category: row.category,
    brand: row.brand,
    model: row.model,
    serialNumber: row.serialNumber,
    assetTag: row.assetTag,
    purchaseDate: isoDate(row.purchaseDate),
    warrantyStart: isoDate(row.warrantyStart),
    warrantyEnd: isoDate(row.warrantyEnd),
    warrantyProvider: row.warrantyProvider,
    warrantyReference: row.warrantyReference,
    proofOfPurchaseFileId: row.proofOfPurchaseFileId,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AssetActor {
  readonly organizationId: string;
  readonly userId: string | null;
}

@Injectable()
export class AssetsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  async categories(organizationId: string): Promise<AssetCategory[]> {
    return this.prisma.assetCategory.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listForCustomer(organizationId: string, customerId: string): Promise<Asset[]> {
    const rows = await this.prisma.asset.findMany({
      where: { organizationId, customerId, isActive: true },
      select: ASSET_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toAssetDto);
  }

  async get(organizationId: string, id: string): Promise<Asset> {
    const row = await this.prisma.asset.findFirst({
      where: { id, organizationId },
      select: ASSET_SELECT,
    });
    if (!row) throw AppException.notFound('Device');
    return toAssetDto(row);
  }

  async createInTx(
    tx: Tx,
    actor: AssetActor,
    input: CreateAssetRequest,
  ): Promise<CreatedAssetResponse> {
    const [customer, category] = await Promise.all([
      tx.customer.findFirst({
        where: { id: input.customerId, organizationId: actor.organizationId, status: 'ACTIVE' },
        select: { id: true },
      }),
      tx.assetCategory.findFirst({
        where: { id: input.categoryId, organizationId: actor.organizationId, isActive: true },
        select: { code: true },
      }),
    ]);
    if (!customer) throw AppException.notFound('Customer');
    if (!category) throw AppException.notFound('Device category');

    const attributes = attributeSchemaFor(category.code).safeParse(input.attributes);
    if (!attributes.success) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'The device details are invalid',
        attributes.error.issues.map((i) => ({
          path: ['attributes', ...i.path].join('.'),
          message: i.message,
        })),
      );
    }
    if (input.proofOfPurchaseFileId) {
      const file = await tx.storedFile.count({
        where: {
          id: input.proofOfPurchaseFileId,
          organizationId: actor.organizationId,
          classification: 'PERSONAL',
        },
      });
      if (file !== 1) throw AppException.notFound('File');
    }

    const serialNormalized = input.serialNumber ? normalizeSerial(input.serialNumber) : null;
    const duplicates = serialNormalized
      ? await tx.asset.findMany({
          where: { organizationId: actor.organizationId, serialNormalized },
          select: { id: true },
          take: 20,
        })
      : [];

    const row = await tx.asset.create({
      data: {
        organizationId: actor.organizationId,
        customerId: input.customerId,
        categoryId: input.categoryId,
        brand: input.brand,
        model: input.model,
        serialNumber: input.serialNumber ?? null,
        serialNormalized: serialNormalized || null,
        assetTag: input.assetTag ?? null,
        purchaseDate: toDate(input.purchaseDate),
        warrantyStart: toDate(input.warrantyStart),
        warrantyEnd: toDate(input.warrantyEnd),
        warrantyProvider: input.warrantyProvider ?? null,
        warrantyReference: input.warrantyReference ?? null,
        proofOfPurchaseFileId: input.proofOfPurchaseFileId ?? null,
        attributes: attributes.data as Prisma.InputJsonValue,
      },
      select: ASSET_SELECT,
    });
    await this.audit.record(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorType: actor.userId ? 'USER' : 'ANONYMOUS',
      action: 'asset.created',
      entityType: 'asset',
      entityId: row.id,
      after: { ...toAssetDto(row), duplicateSerialCount: duplicates.length },
    });
    return {
      asset: toAssetDto(row),
      duplicateSerialWarning:
        duplicates.length > 0
          ? { count: duplicates.length, assetIds: duplicates.map((d) => d.id) }
          : null,
    };
  }

  create(actor: AssetActor, input: CreateAssetRequest): Promise<CreatedAssetResponse> {
    return this.prisma.$transaction((tx) => this.createInTx(tx, actor, input));
  }
}
