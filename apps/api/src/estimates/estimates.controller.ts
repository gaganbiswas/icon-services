import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type CustomerEstimate,
  type Estimate,
  type EstimateDraft,
  EstimateDraftSchema,
  LinkDecisionSchema,
  LinkTokenSchema,
  SendEstimateSchema,
  type SentEstimateResponse,
  UpdateEstimateDraftSchema,
} from '@icon/contracts';
import type { Response } from 'express';
import type { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, Public, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EstimatesService } from './estimates.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('estimates')
@ApiBearerAuth()
@Controller()
export class EstimatesController {
  constructor(private readonly estimates: EstimatesService) {}

  /** Pricing context for estimate editors (currency may be unset — never assumed). */
  @Get('estimates/config')
  @RequirePermissions('estimates.read')
  config(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ currency: string | null; validityDays: number }> {
    return this.estimates.config(principal.organizationId);
  }

  @Get('jobs/:jobId/estimates')
  @RequirePermissions('estimates.read')
  list(
    @CurrentPrincipal() principal: Principal,
    @Param('jobId', uuidPipe) jobId: string,
  ): Promise<Estimate[]> {
    return this.estimates.listForJob(principal, jobId);
  }

  @Post('jobs/:jobId/estimates')
  @RequirePermissions('estimates.write')
  create(
    @CurrentPrincipal() principal: Principal,
    @Param('jobId', uuidPipe) jobId: string,
    @Body(new ZodValidationPipe(EstimateDraftSchema)) body: EstimateDraft,
  ): Promise<Estimate> {
    return this.estimates.createDraft(principal, jobId, body);
  }

  @Get('estimates/:id')
  @RequirePermissions('estimates.read')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Estimate> {
    return this.estimates.get(principal, id);
  }

  @Put('estimates/:id')
  @RequirePermissions('estimates.write')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEstimateDraftSchema))
    body: z.infer<typeof UpdateEstimateDraftSchema>,
  ): Promise<Estimate> {
    return this.estimates.updateDraft(principal, id, body, body.rowVersion);
  }

  @Post('estimates/:id/send')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('estimates.send')
  async send(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(SendEstimateSchema)) body: z.infer<typeof SendEstimateSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SentEstimateResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.estimates.send(principal, id, body.rowVersion);
  }

  @Post('estimates/:id/approval-link')
  @RequirePermissions('estimates.send')
  async link(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ token: string; expiresAt: string }> {
    res.setHeader('Cache-Control', 'no-store');
    return this.estimates.reissueLink(principal, id);
  }
}

/**
 * Public approval-link endpoints (ADR 0014). The token is sent in the body,
 * never in URLs; endpoints are rate-limited per IP.
 */
@ApiTags('estimate-links')
@Public()
@UseGuards(ThrottlerGuard)
@Controller('public/estimate-links')
export class EstimateLinksController {
  constructor(private readonly estimates: EstimatesService) {}

  @Post('view')
  @HttpCode(HttpStatus.OK)
  view(
    @Body(new ZodValidationPipe(LinkTokenSchema)) body: z.infer<typeof LinkTokenSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerEstimate> {
    res.setHeader('Cache-Control', 'no-store');
    return this.estimates.resolveLink(body.token);
  }

  @Post('decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @Body(new ZodValidationPipe(LinkDecisionSchema)) body: z.infer<typeof LinkDecisionSchema>,
  ): Promise<CustomerEstimate> {
    return this.estimates.linkDecision(body.token, body);
  }
}
