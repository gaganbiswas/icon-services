import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Asset,
  type AssetCategory,
  type CreateAssetRequest,
  CreateAssetRequestSchema,
  type CreatedAssetResponse,
} from '@icon/contracts';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AssetsService } from './assets.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('assets')
@ApiBearerAuth()
@Controller()
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('asset-categories')
  @RequirePermissions('assets.read')
  categories(@CurrentPrincipal() principal: Principal): Promise<AssetCategory[]> {
    return this.assets.categories(principal.organizationId);
  }

  @Get('customers/:customerId/assets')
  @RequirePermissions('assets.read')
  forCustomer(
    @CurrentPrincipal() principal: Principal,
    @Param('customerId', uuidPipe) customerId: string,
  ): Promise<Asset[]> {
    return this.assets.listForCustomer(principal.organizationId, customerId);
  }

  @Get('assets/:id')
  @RequirePermissions('assets.read')
  get(@CurrentPrincipal() principal: Principal, @Param('id', uuidPipe) id: string): Promise<Asset> {
    return this.assets.get(principal.organizationId, id);
  }

  @Post('assets')
  @RequirePermissions('assets.write')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateAssetRequestSchema)) body: CreateAssetRequest,
  ): Promise<CreatedAssetResponse> {
    return this.assets.create(
      { organizationId: principal.organizationId, userId: principal.userId },
      body,
    );
  }
}
