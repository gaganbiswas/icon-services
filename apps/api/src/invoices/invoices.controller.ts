import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  AllocationRequestSchema,
  CreditNoteRequestSchema,
  type CreditNoteRequest,
  type DocumentLink,
  INVOICE_STATUSES,
  type Invoice,
  type InvoiceSummary,
  type Page,
  ReleaseAllocationSchema,
  UpdateInvoiceDraftSchema,
} from '@icon/contracts';
import type { PrismaClient } from '@icon/database';
import { Inject } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';

import { branchFilter } from '../access/access-policy.js';
import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DocumentsService } from '../documents/documents.service.js';
import { requireIdempotencyKey } from '../idempotency/idempotency.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { InvoicesService } from './invoices.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const RegisterQuery = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  status: z.enum(INVOICE_STATUSES).optional(),
  branchId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

/** GST invoices, credit notes and payment allocations (Phase 7, ADR 0022). */
@ApiTags('invoices')
@ApiBearerAuth()
@Controller()
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly documents: DocumentsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  @Get('invoicing/status')
  @RequirePermissions('invoices.read')
  async status(
    @CurrentPrincipal() principal: Principal,
  ): Promise<{ blockers: string[]; taxStatus: 'DRAFT' | 'APPROVED' }> {
    const config = await this.invoices.config(principal.organizationId);
    return { blockers: this.invoices.blockers(config), taxStatus: config.tax.status };
  }

  @Get('jobs/:id/invoices')
  @RequirePermissions('invoices.read')
  forJob(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Invoice[]> {
    return this.invoices.forJob(principal, id);
  }

  @Post('jobs/:id/invoices')
  @RequirePermissions('invoices.write')
  createDraft(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.createDraft(principal, id);
  }

  @Get('invoices')
  @RequirePermissions('invoices.read')
  register(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(RegisterQuery)) q: z.infer<typeof RegisterQuery>,
  ): Promise<Page<InvoiceSummary>> {
    return this.invoices.register(principal, q);
  }

  @Get('invoices/:id')
  @RequirePermissions('invoices.read')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Invoice> {
    return this.invoices.get(principal, id);
  }

  @Put('invoices/:id')
  @RequirePermissions('invoices.write')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceDraftSchema))
    body: z.infer<typeof UpdateInvoiceDraftSchema>,
  ): Promise<Invoice> {
    return this.invoices.updateDraft(principal, id, body);
  }

  @Delete('invoices/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('invoices.write')
  async remove(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<void> {
    await this.invoices.deleteDraft(principal, id);
  }

  @Post('invoices/:id/issue')
  @RequirePermissions('invoices.issue')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async issue(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Invoice> {
    const result = await this.invoices.issue(principal, id, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Post('invoices/:id/pdf')
  @RequirePermissions('invoices.read')
  async pdf(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<DocumentLink> {
    await this.invoices.get(principal, id);
    return this.documents.taxInvoice(principal.organizationId, id, { userId: principal.userId });
  }

  @Post('invoices/:id/credit-notes')
  @RequirePermissions('credit_notes.issue')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async creditNote(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreditNoteRequestSchema)) body: CreditNoteRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Invoice> {
    const result = await this.invoices.creditNote(principal, id, body, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Post('credit-notes/:id/pdf')
  @RequirePermissions('invoices.read')
  async creditNotePdf(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<DocumentLink> {
    const note = await this.prisma.creditNote.findFirst({
      where: { id, organizationId: principal.organizationId, ...branchFilter(principal) },
      select: { id: true },
    });
    if (!note) throw AppException.notFound('Credit note');
    return this.documents.creditNote(principal.organizationId, id, { userId: principal.userId });
  }

  @Post('invoices/:id/allocations')
  @RequirePermissions('payments.record')
  allocate(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(AllocationRequestSchema))
    body: z.infer<typeof AllocationRequestSchema>,
  ): Promise<Invoice> {
    return this.invoices.allocatePayment(principal, id, body);
  }

  @Post('allocations/:id/release')
  @RequirePermissions('payments.refund')
  release(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(ReleaseAllocationSchema))
    body: z.infer<typeof ReleaseAllocationSchema>,
  ): Promise<Invoice> {
    return this.invoices.release(principal, id, body.reason);
  }
}
