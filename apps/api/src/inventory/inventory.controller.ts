import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AdjustStockSchema,
  type CreatePart,
  CreatePartSchema,
  CreateSupplierSchema,
  type JobPart,
  type JobPartAction,
  JobPartActionSchema,
  type Page,
  PaginationQuerySchema,
  type Part,
  PartSearchSchema,
  ReceiveStockSchema,
  RemovedPartSchema,
  type StockLevel,
  type StockMovement,
  type Supplier,
  TransferStockSchema,
  type UpdatePart,
  UpdatePartSchema,
} from '@icon/contracts';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { InventoryService } from './inventory.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const StockQuery = z.object({
  branchId: z.uuid(),
  belowReorder: z.enum(['true', 'false']).optional(),
  q: z.string().trim().max(100).optional(),
});
const MovementQuery = PaginationQuerySchema.extend({
  branchId: z.uuid().optional(),
  partId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});
const BranchQuery = z.object({ branchId: z.uuid() });

@ApiTags('inventory')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('parts')
  @RequirePermissions('inventory.read')
  parts(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(PartSearchSchema)) query: z.infer<typeof PartSearchSchema>,
  ): Promise<Part[]> {
    return this.inventory.searchParts(principal, query.q, query.includeInactive === 'true');
  }

  @Post('parts')
  @RequirePermissions('inventory.write')
  createPart(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreatePartSchema)) body: CreatePart,
  ): Promise<Part> {
    return this.inventory.createPart(principal, body);
  }

  @Patch('parts/:id')
  @RequirePermissions('inventory.write')
  updatePart(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePartSchema)) body: UpdatePart,
  ): Promise<Part> {
    return this.inventory.updatePart(principal, id, body);
  }

  @Get('suppliers')
  @RequirePermissions('inventory.read')
  suppliers(@CurrentPrincipal() principal: Principal): Promise<Supplier[]> {
    return this.inventory.suppliers(principal);
  }

  @Post('suppliers')
  @RequirePermissions('inventory.write')
  createSupplier(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateSupplierSchema)) body: z.infer<typeof CreateSupplierSchema>,
  ): Promise<Supplier> {
    return this.inventory.createSupplier(principal, body);
  }

  /** Stock levels for a branch; `belowReorder=true` is the low-stock report. */
  @Get('inventory/stock')
  @RequirePermissions('inventory.read')
  stock(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(StockQuery)) query: z.infer<typeof StockQuery>,
  ): Promise<StockLevel[]> {
    return this.inventory.stockLevels(
      principal,
      query.branchId,
      query.belowReorder === 'true',
      query.q,
    );
  }

  @Post('inventory/receipts')
  @RequirePermissions('inventory.write')
  receive(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(ReceiveStockSchema)) body: z.infer<typeof ReceiveStockSchema>,
  ): Promise<StockLevel> {
    return this.inventory.receive(principal, body);
  }

  @Post('inventory/adjustments')
  @RequirePermissions('inventory.adjust')
  adjust(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(AdjustStockSchema)) body: z.infer<typeof AdjustStockSchema>,
  ): Promise<StockLevel> {
    return this.inventory.adjust(principal, body);
  }

  @Post('inventory/transfers')
  @RequirePermissions('inventory.adjust')
  transfer(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(TransferStockSchema)) body: z.infer<typeof TransferStockSchema>,
  ): Promise<{ from: StockLevel; to: StockLevel }> {
    return this.inventory.transfer(principal, body);
  }

  @Get('inventory/movements')
  @RequirePermissions('inventory.read')
  movements(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(MovementQuery)) query: z.infer<typeof MovementQuery>,
  ): Promise<Page<StockMovement>> {
    return this.inventory.movements(principal, query);
  }

  @Get('inventory/reconciliation')
  @RequirePermissions('inventory.adjust')
  reconciliation(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(BranchQuery)) query: z.infer<typeof BranchQuery>,
  ) {
    return this.inventory.reconciliation(principal, query.branchId);
  }

  @Get('jobs/:id/parts')
  @RequirePermissions('jobs.read')
  jobParts(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<JobPart[]> {
    return this.inventory.jobParts(principal, id);
  }

  @Post('jobs/:id/parts')
  @RequirePermissions('worklogs.write')
  jobPartAction(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(JobPartActionSchema)) body: JobPartAction,
  ): Promise<JobPart[]> {
    return this.inventory.jobPartAction(principal, id, body);
  }

  @Put('jobs/:id/parts/removed')
  @RequirePermissions('worklogs.write')
  removedPart(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(RemovedPartSchema)) body: z.infer<typeof RemovedPartSchema>,
  ): Promise<JobPart[]> {
    return this.inventory.recordRemovedPart(principal, id, body);
  }
}
