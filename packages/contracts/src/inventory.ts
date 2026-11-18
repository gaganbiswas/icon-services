import { z } from 'zod';

import { MoneyStringSchema, QuantityStringSchema } from './money.js';

export const STOCK_MOVEMENT_TYPES = [
  'RECEIVE',
  'ADJUST',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'RESERVE',
  'RELEASE',
  'CONSUME',
  'RETURN',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export const REMOVED_PART_DISPOSITIONS = [
  'RETURNED_TO_CUSTOMER',
  'SENT_TO_VENDOR',
  'SCRAPPED',
  'KEPT_FOR_WARRANTY_CLAIM',
] as const;

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();

export const SkuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,59}$/, 'Use letters, digits, “.”, “_”, “/” or “-”');

export const CreatePartSchema = z.object({
  sku: SkuSchema,
  name: text(200),
  description: optionalText(1000),
  category: optionalText(100),
  unit: text(20).default('EA'),
  reorderLevel: MoneyStringSchema.default('0'),
  sellingPrice: MoneyStringSchema.optional(),
});
export type CreatePart = z.infer<typeof CreatePartSchema>;

export const UpdatePartSchema = CreatePartSchema.omit({ sku: true })
  .partial()
  .extend({ version: z.number().int().min(1), isActive: z.boolean().optional() });
export type UpdatePart = z.infer<typeof UpdatePartSchema>;

export const PartSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  unit: z.string(),
  reorderLevel: z.string(),
  sellingPrice: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type Part = z.infer<typeof PartSchema>;

export const StockLevelSchema = z.object({
  part: PartSchema,
  branchId: z.uuid(),
  onHand: z.string(),
  reserved: z.string(),
  available: z.string(),
  reorderLevel: z.string(),
  belowReorder: z.boolean(),
});
export type StockLevel = z.infer<typeof StockLevelSchema>;

export const SupplierSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  isActive: z.boolean(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

export const CreateSupplierSchema = z.object({
  name: text(200),
  phone: optionalText(32),
  email: z.string().trim().pipe(z.email().max(254)).optional(),
  notes: optionalText(1000),
});

/** Negative-stock override: needs inventory.negative_override and a reason (ADR 0015). */
const override = {
  allowNegative: z.boolean().default(false),
  reason: optionalText(500),
};

export const ReceiveStockSchema = z.object({
  branchId: z.uuid(),
  partId: z.uuid(),
  quantity: QuantityStringSchema,
  unitCost: MoneyStringSchema.optional(),
  supplierId: z.uuid().optional(),
  reference: optionalText(100),
});

export const AdjustStockSchema = z.object({
  branchId: z.uuid(),
  partId: z.uuid(),
  direction: z.enum(['INCREASE', 'DECREASE']),
  quantity: QuantityStringSchema,
  reason: text(500),
  allowNegative: z.boolean().default(false),
});

export const TransferStockSchema = z
  .object({
    fromBranchId: z.uuid(),
    toBranchId: z.uuid(),
    partId: z.uuid(),
    quantity: QuantityStringSchema,
    reason: optionalText(500),
  })
  .refine((v) => v.fromBranchId !== v.toBranchId, {
    message: 'Choose two different branches',
    path: ['toBranchId'],
  });

export const JobPartActionSchema = z
  .object({
    partId: z.uuid(),
    action: z.enum(['RESERVE', 'RELEASE', 'CONSUME', 'RETURN']),
    quantity: QuantityStringSchema,
    ...override,
  })
  .refine((v) => !v.allowNegative || v.reason !== undefined, {
    message: 'A reason is required to allow negative stock',
    path: ['reason'],
  });
export type JobPartAction = z.infer<typeof JobPartActionSchema>;

export const RemovedPartSchema = z.object({
  partId: z.uuid(),
  removedPartDescription: text(300),
  removedPartSerial: optionalText(100),
  disposition: z.enum(REMOVED_PART_DISPOSITIONS),
});

export const JobPartSchema = z.object({
  id: z.uuid(),
  part: z.object({ id: z.uuid(), sku: z.string(), name: z.string(), unit: z.string() }),
  reserved: z.string(),
  consumed: z.string(),
  returned: z.string(),
  removedPartDescription: z.string().nullable(),
  removedPartSerial: z.string().nullable(),
  disposition: z.enum(REMOVED_PART_DISPOSITIONS).nullable(),
});
export type JobPart = z.infer<typeof JobPartSchema>;

export const StockMovementSchema = z.object({
  id: z.uuid(),
  type: z.enum(STOCK_MOVEMENT_TYPES),
  branchId: z.uuid(),
  partId: z.uuid(),
  onHandDelta: z.string(),
  reservedDelta: z.string(),
  unitCost: z.string().nullable(),
  jobId: z.uuid().nullable(),
  reason: z.string().nullable(),
  negativeOverride: z.boolean(),
  actor: z.object({ id: z.uuid(), fullName: z.string() }),
  createdAt: z.iso.datetime(),
});
export type StockMovement = z.infer<typeof StockMovementSchema>;

export const PartSearchSchema = z.object({
  q: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
  includeInactive: z.enum(['true', 'false']).optional(),
});
