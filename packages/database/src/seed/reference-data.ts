import { SEEDED_ASSET_CATEGORIES } from '@icon/contracts';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * Inserts any missing default asset categories for an organization.
 * Existing categories (possibly renamed/deactivated by admins) are untouched.
 */
export async function ensureAssetCategories(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<void> {
  await tx.assetCategory.createMany({
    data: SEEDED_ASSET_CATEGORIES.map((c) => ({
      organizationId,
      code: c.code,
      name: c.name,
      sortOrder: c.sortOrder,
    })),
    skipDuplicates: true,
  });
}
