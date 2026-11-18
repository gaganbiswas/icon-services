import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  type CollectionsReport,
  type CustomerAccount,
  type DocumentLink,
  type Page,
  PaginationQuerySchema,
  type Payment,
  type RecordPayment,
  RecordPaymentSchema,
  ReceiptLayoutSchema,
  type RefundRequest,
  RefundSchema,
  ReversalSchema,
} from '@icon/contracts';
import type { Response } from 'express';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DocumentsService } from '../documents/documents.service.js';
import { requireIdempotencyKey } from '../idempotency/idempotency.service.js';
import { PaymentsService } from './payments.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const ListQuery = PaginationQuerySchema.extend({
  customerId: z.uuid().optional(),
  jobId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
const ReceiptQuery = z.object({ layout: ReceiptLayoutSchema.default('A4') });
const CollectionsQuery = z
  .object({ from: z.iso.datetime(), to: z.iso.datetime(), branchId: z.uuid().optional() })
  .refine((v) => v.from < v.to, { message: '“from” must be before “to”', path: ['to'] });

@ApiTags('payments')
@ApiBearerAuth()
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('payments')
  @RequirePermissions('payments.record')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async record(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(RecordPaymentSchema)) body: RecordPayment,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Payment> {
    const result = await this.payments.record(principal, body, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get('payments')
  @RequirePermissions('payments.read')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ): Promise<Page<Payment>> {
    return this.payments.list(principal, query);
  }

  @Get('payments/:id')
  @RequirePermissions('payments.read')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Payment> {
    return this.payments.get(principal, id);
  }

  @Post('payments/:id/refunds')
  @RequirePermissions('payments.refund')
  refund(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(RefundSchema)) body: RefundRequest,
  ): Promise<Payment> {
    return this.payments.refund(principal, id, body);
  }

  @Post('payments/:id/reversal')
  @RequirePermissions('payments.refund')
  reverse(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(ReversalSchema)) body: z.infer<typeof ReversalSchema>,
  ): Promise<Payment> {
    return this.payments.reverse(principal, id, body.reason);
  }

  @Post('payments/:id/receipt')
  @RequirePermissions('payments.read')
  async receipt(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(ReceiptQuery)) query: z.infer<typeof ReceiptQuery>,
  ): Promise<DocumentLink> {
    await this.payments.get(principal, id); // scope check
    return this.documents.paymentReceipt(principal.organizationId, id, query.layout, {
      userId: principal.userId,
    });
  }

  @Get('customers/:id/account')
  @RequirePermissions('payments.read')
  account(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<CustomerAccount> {
    return this.payments.account(principal, id);
  }

  @Get('reports/collections')
  @RequirePermissions('reports.read', 'payments.read')
  collections(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(CollectionsQuery)) query: z.infer<typeof CollectionsQuery>,
  ): Promise<CollectionsReport> {
    return this.payments.collections(
      principal,
      new Date(query.from),
      new Date(query.to),
      query.branchId,
    );
  }
}
