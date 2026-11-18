import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type Address,
  type ChangeConsentRequest,
  type Consent,
  type CreateCustomerRequest,
  type Customer,
  type Page,
  type PaginationQuery,
  type UpdateCustomerRequest,
  normalizePhone,
} from '@icon/contracts';
import { Prisma, type PrismaClient } from '@icon/database';

import type { Principal } from '../access/principal.js';
import { AuditService } from '../audit/audit.service.js';
import { AppException } from '../common/app-exception.js';
import { NumberingService } from '../numbering/numbering.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CUSTOMER_SELECT, customerAudit, toConsentDto, toCustomerDto } from './customer.mapper.js';

type Tx = Prisma.TransactionClient;

export interface CustomerActor {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly source: 'INTAKE_STAFF' | 'CUSTOMER_APP' | 'WEB_PORTAL';
}

@Injectable()
export class CustomersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly settings: SettingsService,
  ) {}

  async phone(
    organizationId: string,
    raw: string,
    field: string,
    db: Tx | PrismaClient = this.prisma,
  ) {
    const { defaultRegion } = await this.settings.get(organizationId, 'phone', db);
    const phone = normalizePhone(raw, defaultRegion ?? undefined);
    if (!phone) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'INVALID_PHONE',
        'The phone number is invalid',
        [
          {
            path: field,
            message: defaultRegion
              ? 'Enter a valid phone number'
              : 'Enter a valid number including the country code, e.g. +91…',
          },
        ],
      );
    }
    return phone;
  }

  async search(
    principal: Principal,
    q: string | undefined,
    page: PaginationQuery,
  ): Promise<Page<Customer>> {
    const where: Prisma.CustomerWhereInput = {
      organizationId: principal.organizationId,
      status: 'ACTIVE',
    };
    if (q) {
      const digits = q.replace(/[^\d+]/g, '');
      const or: Prisma.CustomerWhereInput[] = [
        { name: { contains: q, mode: 'insensitive' } },
        { customerCode: { equals: q.toUpperCase() } },
        { email: { equals: q, mode: 'insensitive' } },
      ];
      if (digits.replace('+', '').length >= 4) {
        or.push(
          { phoneE164: { contains: digits.replace(/^0+/, '') } },
          { altPhoneE164: { contains: digits.replace(/^0+/, '') } },
        );
      }
      where.OR = or;
    }
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        select: CUSTOMER_SELECT,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page.page - 1) * page.pageSize,
        take: page.pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
    return { items: rows.map(toCustomerDto), page: page.page, pageSize: page.pageSize, total };
  }

  async get(
    organizationId: string,
    id: string,
    db: Tx | PrismaClient = this.prisma,
  ): Promise<Customer> {
    const row = await db.customer.findFirst({
      where: { id, organizationId, status: 'ACTIVE' },
      select: CUSTOMER_SELECT,
    });
    if (!row) throw AppException.notFound('Customer');
    return toCustomerDto(row);
  }

  /** Creates a customer inside an existing transaction (used by intake and sign-up too). */
  async createInTx(tx: Tx, actor: CustomerActor, input: CreateCustomerRequest): Promise<Customer> {
    const phone = await this.phone(actor.organizationId, input.phone, 'phone', tx);
    const altPhone = input.altPhone
      ? await this.phone(actor.organizationId, input.altPhone, 'altPhone', tx)
      : null;
    const format = await this.settings.get(actor.organizationId, 'numbering.customerCode', tx);
    const organization = await tx.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { timezone: true },
    });
    const customerCode = await this.numbering.next(tx, {
      organizationId: actor.organizationId,
      documentType: 'CUSTOMER',
      format,
      timeZone: organization.timezone,
    });
    const { consentPolicyVersion } = await this.settings.get(actor.organizationId, 'privacy', tx);

    const created = await tx.customer.create({
      data: {
        organizationId: actor.organizationId,
        customerCode,
        type: input.type,
        name: input.name,
        contactPerson: input.contactPerson ?? null,
        phoneE164: phone.e164,
        phoneDisplay: phone.display,
        altPhoneE164: altPhone?.e164 ?? null,
        altPhoneDisplay: altPhone?.display ?? null,
        email: input.email ?? null,
        taxIdentifier: input.taxIdentifier ?? null,
        preferredLanguage: input.preferredLanguage ?? null,
        notes: input.notes ?? null,
        source: actor.source,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    await this.writeAddress(tx, created.id, 'BILLING', input.billingAddress);
    await this.writeAddress(tx, created.id, 'SERVICE', input.serviceAddress);
    const consentSource = actor.source === 'INTAKE_STAFF' ? 'STAFF_ENTRY' : actor.source;
    const uniqueConsents = new Map(input.consents.map((c) => [`${c.channel}:${c.purpose}`, c]));
    for (const consent of uniqueConsents.values()) {
      await tx.customerConsent.create({
        data: {
          organizationId: actor.organizationId,
          customerId: created.id,
          channel: consent.channel,
          purpose: consent.purpose,
          policyVersion: consentPolicyVersion,
          source: consentSource,
          recordedById: actor.userId,
        },
      });
    }
    const row = await tx.customer.findUniqueOrThrow({
      where: { id: created.id },
      select: CUSTOMER_SELECT,
    });
    await this.audit.record(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      actorType: actor.userId ? 'USER' : 'ANONYMOUS',
      action: 'customer.created',
      entityType: 'customer',
      entityId: row.id,
      after: customerAudit(row),
    });
    return toCustomerDto(row);
  }

  create(principal: Principal, input: CreateCustomerRequest): Promise<Customer> {
    return this.prisma.$transaction((tx) =>
      this.createInTx(
        tx,
        {
          organizationId: principal.organizationId,
          userId: principal.userId,
          source: 'INTAKE_STAFF',
        },
        input,
      ),
    );
  }

  async update(principal: Principal, id: string, input: UpdateCustomerRequest): Promise<Customer> {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.customer.findFirst({
        where: { id, organizationId: principal.organizationId, status: 'ACTIVE' },
        select: CUSTOMER_SELECT,
      });
      if (!before) throw AppException.notFound('Customer');
      if (before.version !== input.version) throw AppException.versionConflict();

      const data: Prisma.CustomerUpdateManyMutationInput = { version: { increment: 1 } };
      if (input.name !== undefined) data.name = input.name;
      if (input.contactPerson !== undefined) data.contactPerson = input.contactPerson ?? null;
      if (input.email !== undefined) data.email = input.email ?? null;
      if (input.taxIdentifier !== undefined) data.taxIdentifier = input.taxIdentifier ?? null;
      if (input.preferredLanguage !== undefined)
        data.preferredLanguage = input.preferredLanguage ?? null;
      if (input.notes !== undefined) data.notes = input.notes ?? null;
      if (input.phone !== undefined) {
        const phone = await this.phone(principal.organizationId, input.phone, 'phone', tx);
        data.phoneE164 = phone.e164;
        data.phoneDisplay = phone.display;
      }
      if (input.altPhone !== undefined) {
        const alt = await this.phone(principal.organizationId, input.altPhone, 'altPhone', tx);
        data.altPhoneE164 = alt.e164;
        data.altPhoneDisplay = alt.display;
      }
      const updated = await tx.customer.updateMany({
        where: { id, organizationId: principal.organizationId, version: input.version },
        data,
      });
      if (updated.count !== 1) throw AppException.versionConflict();
      if (input.billingAddress !== undefined)
        await this.replaceAddress(tx, id, 'BILLING', input.billingAddress);
      if (input.serviceAddress !== undefined)
        await this.replaceAddress(tx, id, 'SERVICE', input.serviceAddress);

      const after = await tx.customer.findUniqueOrThrow({ where: { id }, select: CUSTOMER_SELECT });
      await this.audit.record(tx, {
        organizationId: principal.organizationId,
        actorUserId: principal.userId,
        action: 'customer.updated',
        entityType: 'customer',
        entityId: id,
        before: customerAudit(before),
        after: customerAudit(after),
      });
      return toCustomerDto(after);
    });
  }

  /** Grants or withdraws one consent (append-only history). */
  async changeConsent(
    organizationId: string,
    customerId: string,
    change: ChangeConsentRequest,
    actor: { userId: string | null; source: 'STAFF_ENTRY' | 'CUSTOMER_APP' | 'WEB_PORTAL' },
  ): Promise<Consent[]> {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (!customer) throw AppException.notFound('Customer');
      const now = new Date();
      const active = await tx.customerConsent.findFirst({
        where: { customerId, channel: change.channel, purpose: change.purpose, withdrawnAt: null },
      });
      if (change.granted && !active) {
        const { consentPolicyVersion } = await this.settings.get(organizationId, 'privacy', tx);
        await tx.customerConsent.create({
          data: {
            organizationId,
            customerId,
            channel: change.channel,
            purpose: change.purpose,
            policyVersion: consentPolicyVersion,
            source: actor.source,
            recordedById: actor.userId,
          },
        });
      } else if (!change.granted && active) {
        await tx.customerConsent.update({
          where: { id: active.id },
          data: { withdrawnAt: now, withdrawnSource: actor.source },
        });
      }
      if (change.granted !== Boolean(active)) {
        await this.audit.record(tx, {
          organizationId,
          actorUserId: actor.userId,
          actorType: actor.userId ? 'USER' : 'ANONYMOUS',
          action: change.granted ? 'customer.consent.granted' : 'customer.consent.withdrawn',
          entityType: 'customer',
          entityId: customerId,
          after: { channel: change.channel, purpose: change.purpose, source: actor.source },
        });
      }
      const rows = await tx.customerConsent.findMany({
        where: { customerId, withdrawnAt: null },
        orderBy: { grantedAt: 'asc' },
      });
      return rows.map(toConsentDto);
    });
  }

  private async writeAddress(
    tx: Tx,
    customerId: string,
    kind: 'BILLING' | 'SERVICE',
    address: Address | undefined,
  ) {
    if (!address) return;
    await tx.customerAddress.create({
      data: {
        customerId,
        kind,
        line1: address.line1,
        line2: address.line2 ?? null,
        city: address.city,
        region: address.region ?? null,
        postalCode: address.postalCode ?? null,
        countryCode: address.countryCode,
      },
    });
  }

  private async replaceAddress(
    tx: Tx,
    customerId: string,
    kind: 'BILLING' | 'SERVICE',
    address: Address | null,
  ) {
    await tx.customerAddress.deleteMany({ where: { customerId, kind } });
    if (address) await this.writeAddress(tx, customerId, kind, address);
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
