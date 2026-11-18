import { z } from 'zod';

export const SEEDED_ASSET_CATEGORIES = [
  { code: 'DESKTOP', name: 'Desktop', sortOrder: 10 },
  { code: 'LAPTOP', name: 'Laptop', sortOrder: 20 },
  { code: 'PRINTER', name: 'Printer', sortOrder: 30 },
  { code: 'MONITOR', name: 'Monitor', sortOrder: 40 },
  { code: 'OTHER', name: 'Other', sortOrder: 90 },
] as const;

const attr = z.string().trim().max(200).optional();

/**
 * Category-specific attributes (validated JSONB, CLAUDE.md §4.1). Unknown
 * categories accept up to 20 short string attributes.
 */
export const ASSET_ATTRIBUTE_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  DESKTOP: z.object({ processor: attr, ram: attr, storage: attr, operatingSystem: attr }).strict(),
  LAPTOP: z
    .object({
      processor: attr,
      ram: attr,
      storage: attr,
      operatingSystem: attr,
      screenSize: attr,
      chargerSerial: attr,
    })
    .strict(),
  PRINTER: z.object({ printerType: attr, connectivity: attr, pageCount: attr }).strict(),
  MONITOR: z.object({ screenSize: attr, panelType: attr, resolution: attr }).strict(),
};

export const GenericAttributesSchema = z
  .record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), z.string().trim().max(200))
  .refine((v) => Object.keys(v).length <= 20, 'At most 20 attributes');

export function attributeSchemaFor(categoryCode: string): z.ZodType<Record<string, unknown>> {
  return ASSET_ATTRIBUTE_SCHEMAS[categoryCode] ?? GenericAttributesSchema;
}

const isoDate = z.iso.date();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const CreateAssetRequestSchema = z
  .object({
    customerId: z.uuid(),
    categoryId: z.uuid(),
    brand: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(150),
    serialNumber: optionalText(100),
    assetTag: optionalText(100),
    purchaseDate: isoDate.optional(),
    warrantyStart: isoDate.optional(),
    warrantyEnd: isoDate.optional(),
    warrantyProvider: optionalText(150),
    warrantyReference: optionalText(150),
    proofOfPurchaseFileId: z.uuid().optional(),
    attributes: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((v) => !v.warrantyStart || !v.warrantyEnd || v.warrantyEnd >= v.warrantyStart, {
    message: 'Warranty end must be on or after warranty start',
    path: ['warrantyEnd'],
  });
export type CreateAssetRequest = z.infer<typeof CreateAssetRequestSchema>;

export const AssetCategorySchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const AssetSchema = z.object({
  id: z.uuid(),
  customerId: z.uuid(),
  category: AssetCategorySchema,
  brand: z.string(),
  model: z.string(),
  serialNumber: z.string().nullable(),
  assetTag: z.string().nullable(),
  purchaseDate: z.iso.date().nullable(),
  warrantyStart: z.iso.date().nullable(),
  warrantyEnd: z.iso.date().nullable(),
  warrantyProvider: z.string().nullable(),
  warrantyReference: z.string().nullable(),
  proofOfPurchaseFileId: z.uuid().nullable(),
  attributes: z.record(z.string(), z.unknown()),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type Asset = z.infer<typeof AssetSchema>;

export const CreatedAssetResponseSchema = z.object({
  asset: AssetSchema,
  /** Other assets in the organization with the same normalized serial number. */
  duplicateSerialWarning: z
    .object({ count: z.number().int(), assetIds: z.array(z.uuid()) })
    .nullable(),
});
export type CreatedAssetResponse = z.infer<typeof CreatedAssetResponseSchema>;

/** Upper-case, strip spaces/dashes/dots for duplicate detection. */
export function normalizeSerial(serial: string): string {
  return serial.toUpperCase().replace(/[\s\-._/]/g, '');
}
