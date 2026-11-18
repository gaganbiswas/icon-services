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
  type Balance,
  type Delivery,
  type DispatchRequest,
  DispatchSchema,
  type DocumentLink,
  FailedAttemptSchema,
  type HandoverRequest,
  HandoverSchema,
  type Page,
  PaginationQuerySchema,
  ReceiptLayoutSchema,
} from '@icon/contracts';
import type { Response } from 'express';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DocumentsService } from '../documents/documents.service.js';
import { requireIdempotencyKey } from '../idempotency/idempotency.service.js';
import { DeliveryService } from './delivery.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const LayoutQuery = z.object({ layout: ReceiptLayoutSchema.default('A4') });
const RegisterQuery = PaginationQuerySchema.extend({
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  branchId: z.uuid().optional(),
});

@ApiTags('delivery')
@ApiBearerAuth()
@Controller()
export class DeliveryController {
  constructor(
    private readonly delivery: DeliveryService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('jobs/:id/deliveries')
  @RequirePermissions('deliveries.read')
  forJob(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<{ deliveries: Delivery[]; balance: Balance; requiredItems: string[] }> {
    return this.delivery.jobDeliveries(principal, id);
  }

  @Post('jobs/:id/deliveries/dispatch')
  @RequirePermissions('deliveries.write')
  dispatch(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(DispatchSchema)) body: DispatchRequest,
  ): Promise<Delivery> {
    return this.delivery.dispatch(principal, id, body);
  }

  @Post('jobs/:id/deliveries/handover')
  @RequirePermissions('deliveries.complete')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async handover(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(HandoverSchema)) body: HandoverRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Delivery> {
    const result = await this.delivery.handover(principal, id, body, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Post('deliveries/:id/failed-attempt')
  @RequirePermissions('deliveries.write')
  failed(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(FailedAttemptSchema)) body: z.infer<typeof FailedAttemptSchema>,
  ): Promise<Delivery> {
    return this.delivery.failedAttempt(principal, id, body.reason);
  }

  @Post('deliveries/:id/challan')
  @RequirePermissions('deliveries.read')
  async challan(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(LayoutQuery)) query: z.infer<typeof LayoutQuery>,
  ): Promise<DocumentLink> {
    await this.delivery.assertInScope(principal, id);
    return this.documents.deliveryChallan(principal.organizationId, id, query.layout, {
      userId: principal.userId,
    });
  }

  @Get('deliveries')
  @RequirePermissions('deliveries.read')
  register(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(RegisterQuery)) query: z.infer<typeof RegisterQuery>,
  ): Promise<Page<Delivery>> {
    return this.delivery.register(principal, query);
  }
}
