import type { Consent, Customer } from '@icon/contracts';
import type { Prisma } from '@icon/database';

export const CUSTOMER_SELECT = {
  id: true,
  customerCode: true,
  type: true,
  name: true,
  contactPerson: true,
  phoneDisplay: true,
  altPhoneDisplay: true,
  email: true,
  taxIdentifier: true,
  preferredLanguage: true,
  notes: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  addresses: {
    select: {
      kind: true,
      line1: true,
      line2: true,
      city: true,
      region: true,
      postalCode: true,
      countryCode: true,
    },
  },
  consents: {
    where: { withdrawnAt: null },
    select: {
      id: true,
      channel: true,
      purpose: true,
      policyVersion: true,
      source: true,
      grantedAt: true,
      withdrawnAt: true,
    },
    orderBy: { grantedAt: 'asc' },
  },
} satisfies Prisma.CustomerSelect;

export type CustomerRow = Prisma.CustomerGetPayload<{ select: typeof CUSTOMER_SELECT }>;

export function toConsentDto(c: CustomerRow['consents'][number]): Consent {
  return {
    id: c.id,
    channel: c.channel,
    purpose: c.purpose,
    policyVersion: c.policyVersion,
    source: c.source,
    grantedAt: c.grantedAt.toISOString(),
    withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
  };
}

export function toCustomerDto(row: CustomerRow): Customer {
  const address = (kind: 'BILLING' | 'SERVICE') => {
    const a = row.addresses.find((x) => x.kind === kind);
    return a
      ? {
          line1: a.line1,
          line2: a.line2,
          city: a.city,
          region: a.region,
          postalCode: a.postalCode,
          countryCode: a.countryCode,
        }
      : null;
  };
  return {
    id: row.id,
    customerCode: row.customerCode,
    type: row.type,
    name: row.name,
    contactPerson: row.contactPerson,
    phone: row.phoneDisplay,
    altPhone: row.altPhoneDisplay,
    email: row.email,
    taxIdentifier: row.taxIdentifier,
    preferredLanguage: row.preferredLanguage,
    notes: row.notes,
    billingAddress: address('BILLING'),
    serviceAddress: address('SERVICE'),
    activeConsents: row.consents.map(toConsentDto),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Audit snapshot without free-text notes. */
export function customerAudit(row: CustomerRow) {
  const dto = toCustomerDto(row);
  return {
    ...dto,
    notes: dto.notes ? '[present]' : null,
    activeConsents: dto.activeConsents.map((c) => `${c.channel}:${c.purpose}`),
  };
}
