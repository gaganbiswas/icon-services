import { describe, expect, it } from 'vitest';

import { CreatePartSchema, JobPartActionSchema, TransferStockSchema } from './inventory.js';

const id = '01a1eeac-6f23-74c8-bac5-000000000001';

describe('inventory schemas', () => {
  it('normalizes SKUs and applies defaults', () => {
    expect(CreatePartSchema.parse({ sku: ' kb-x1 ', name: 'Keyboard' })).toMatchObject({
      sku: 'KB-X1',
      unit: 'EA',
      reorderLevel: '0',
    });
    expect(CreatePartSchema.safeParse({ sku: 'bad sku', name: 'x' }).success).toBe(false);
  });

  it('requires positive quantities and a reason for negative-stock overrides', () => {
    expect(
      JobPartActionSchema.safeParse({ partId: id, action: 'CONSUME', quantity: '0' }).success,
    ).toBe(false);
    expect(
      JobPartActionSchema.safeParse({
        partId: id,
        action: 'CONSUME',
        quantity: '1',
        allowNegative: true,
      }).success,
    ).toBe(false);
    expect(
      JobPartActionSchema.safeParse({
        partId: id,
        action: 'CONSUME',
        quantity: '1',
        allowNegative: true,
        reason: 'Part fitted before receipt booked',
      }).success,
    ).toBe(true);
  });

  it('rejects transfers to the same branch', () => {
    expect(
      TransferStockSchema.safeParse({ fromBranchId: id, toBranchId: id, partId: id, quantity: '1' })
        .success,
    ).toBe(false);
  });
});
