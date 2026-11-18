import { describe, expect, it } from 'vitest';

import { HandoverSchema } from './delivery.js';

const base = {
  version: 3,
  mode: 'CUSTOMER_PICKUP',
  recipientName: 'Asha Rao',
  relationship: 'SELF',
  items: [{ description: 'Laptop', returned: true }],
  proofMethod: 'SIGNED_CHALLAN',
};

describe('HandoverSchema', () => {
  it('accepts a complete self pick-up', () => {
    expect(HandoverSchema.safeParse(base).success).toBe(true);
  });

  it('requires authorization for someone other than the customer', () => {
    expect(HandoverSchema.safeParse({ ...base, relationship: 'FAMILY' }).success).toBe(false);
    expect(
      HandoverSchema.safeParse({
        ...base,
        relationship: 'FAMILY',
        authorizationNote: 'Wife, showed ID',
      }).success,
    ).toBe(true);
  });

  it('requires a photo for photo proof and refuses partial delivery', () => {
    expect(HandoverSchema.safeParse({ ...base, proofMethod: 'PHOTO_PROOF' }).success).toBe(false);
    expect(
      HandoverSchema.safeParse({ ...base, items: [{ description: 'Charger', returned: false }] })
        .success,
    ).toBe(false);
  });
});
