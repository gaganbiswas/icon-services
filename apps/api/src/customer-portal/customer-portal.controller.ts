import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type Asset,
  type AssetCategory,
  type ChangeConsentRequest,
  ChangeConsentRequestSchema,
  type Consent,
  type CustomerComplaintRequest,
  CustomerComplaintRequestSchema,
  type CustomerJob,
  type CustomerEstimate,
  type CustomerPayment,
  type CustomerProfile,
  type EstimateDecisionRequest,
  EstimateDecisionSchema,
  type DocumentLink,
  ReceiptLayoutSchema,
  type StoredFileInfo,
  type CustomerInvoice,
} from '@icon/contracts';
import type { PrismaClient } from '@icon/database';
import type { Response } from 'express';
import { z } from 'zod';

import { AssetsService } from '../assets/assets.service.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  type CustomerPrincipal,
  CurrentCustomer,
  CustomerRoute,
} from '../customer-auth/customer-principal.js';
import { CustomersService } from '../customers/customers.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { EstimatesService } from '../estimates/estimates.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { uploadInterceptor } from '../files/files.controller.js';
import { FilesService } from '../files/files.service.js';
import { requireIdempotencyKey } from '../idempotency/idempotency.service.js';
import { PRISMA } from '../prisma/prisma.service.js';
import { CustomerPortalService } from './customer-portal.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const ReceiptQuery = z.object({ layout: ReceiptLayoutSchema.default('A4') });

/**
 * Customer-facing API. Identity always comes from the customer token — never
 * from IDs in the request (CLAUDE.md §7). Responses use customer-safe DTOs.
 */
@ApiTags('customer')
@ApiBearerAuth()
@CustomerRoute()
@Controller('customer')
export class CustomerPortalController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly portal: CustomerPortalService,
    private readonly assets: AssetsService,
    private readonly customers: CustomersService,
    private readonly files: FilesService,
    private readonly documents: DocumentsService,
    private readonly estimates: EstimatesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get('me')
  async me(@CurrentCustomer() me: CustomerPrincipal): Promise<CustomerProfile> {
    const row = await this.prisma.customer.findUniqueOrThrow({
      where: { id: me.customerId },
      select: {
        id: true,
        customerCode: true,
        name: true,
        phoneDisplay: true,
        email: true,
        organization: { select: { code: true, displayName: true } },
      },
    });
    return {
      id: row.id,
      customerCode: row.customerCode,
      name: row.name,
      phone: row.phoneDisplay,
      email: row.email,
      organization: row.organization,
    };
  }

  @Get('branches')
  branches(@CurrentCustomer() me: CustomerPrincipal): Promise<{ id: string; name: string }[]> {
    return this.prisma.branch.findMany({
      where: { organizationId: me.organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  @Get('asset-categories')
  categories(@CurrentCustomer() me: CustomerPrincipal): Promise<AssetCategory[]> {
    return this.assets.categories(me.organizationId);
  }

  @Get('assets')
  myAssets(@CurrentCustomer() me: CustomerPrincipal): Promise<Asset[]> {
    return this.assets.listForCustomer(me.organizationId, me.customerId);
  }

  @Get('jobs')
  myJobs(@CurrentCustomer() me: CustomerPrincipal): Promise<CustomerJob[]> {
    return this.portal.listJobs(me);
  }

  @Get('jobs/:id')
  myJob(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
  ): Promise<CustomerJob> {
    return this.portal.getJob(me, id);
  }

  @Post('jobs')
  async submit(
    @CurrentCustomer() me: CustomerPrincipal,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CustomerComplaintRequestSchema)) body: CustomerComplaintRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerJob> {
    const result = await this.portal.submitComplaint(me, body, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Post('jobs/:id/receipt')
  async receipt(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(ReceiptQuery)) query: z.infer<typeof ReceiptQuery>,
  ): Promise<DocumentLink> {
    await this.portal.getJob(me, id); // ownership check (404 otherwise)
    return this.documents.jobReceipt(me.organizationId, id, query.layout, { userId: null });
  }

  @Post('files')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(uploadInterceptor)
  upload(
    @CurrentCustomer() me: CustomerPrincipal,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredFileInfo> {
    if (!file) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        'VALIDATION_FAILED',
        'Attach a file in the "file" field',
      );
    }
    return this.files.upload(
      me.organizationId,
      { kind: 'customer', customerId: me.customerId },
      file.buffer,
      file.originalname,
    );
  }

  @Put('consents')
  changeConsent(
    @CurrentCustomer() me: CustomerPrincipal,
    @Body(new ZodValidationPipe(ChangeConsentRequestSchema)) body: ChangeConsentRequest,
  ): Promise<Consent[]> {
    return this.customers.changeConsent(me.organizationId, me.customerId, body, {
      userId: null,
      source: 'CUSTOMER_APP',
    });
  }

  @Get('jobs/:id/estimates')
  myEstimates(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
  ): Promise<CustomerEstimate[]> {
    return this.estimates.listForCustomer(me.organizationId, me.customerId, id);
  }

  @Post('estimates/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(EstimateDecisionSchema)) body: EstimateDecisionRequest,
  ): Promise<CustomerEstimate> {
    return this.estimates.customerDecision(me.organizationId, me.customerId, id, body);
  }

  @Get('payments')
  myPayments(@CurrentCustomer() me: CustomerPrincipal): Promise<CustomerPayment[]> {
    return this.payments.customerPayments(me.organizationId, me.customerId);
  }

  @Get('invoices')
  async myInvoices(@CurrentCustomer() me: CustomerPrincipal): Promise<CustomerInvoice[]> {
    const rows = await this.prisma.invoice.findMany({
      where: {
        organizationId: me.organizationId,
        customerId: me.customerId,
        status: { in: ['ISSUED', 'CANCELLED'] },
      },
      orderBy: [{ invoiceDate: 'desc' }, { invoiceNumber: 'desc' }],
      include: {
        job: { select: { jobNumber: true } },
        creditNotes: { orderBy: { createdAt: 'asc' } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber ?? '',
      documentType: r.documentType,
      invoiceDate: r.invoiceDate?.toISOString().slice(0, 10) ?? '',
      jobNumber: r.job.jobNumber,
      currency: r.currency,
      total: r.total.toFixed(2),
      creditedTotal: r.creditedTotal.toFixed(2),
      balance: r.total.minus(r.creditedTotal).minus(r.allocatedTotal).toFixed(2),
      status: r.status === 'CANCELLED' ? 'CANCELLED' : 'ISSUED',
      creditNotes: r.creditNotes.map((c) => ({
        id: c.id,
        number: c.creditNoteNumber,
        date: c.noteDate.toISOString().slice(0, 10),
        total: c.total.toFixed(2),
      })),
    }));
  }

  @Post('invoices/:id/pdf')
  async invoicePdf(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
  ): Promise<DocumentLink> {
    const owned = await this.prisma.invoice.count({
      where: {
        id,
        organizationId: me.organizationId,
        customerId: me.customerId,
        status: { in: ['ISSUED', 'CANCELLED'] },
      },
    });
    if (owned !== 1) throw AppException.notFound('Invoice');
    return this.documents.taxInvoice(me.organizationId, id, { userId: null });
  }

  @Post('credit-notes/:id/pdf')
  async creditNotePdf(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
  ): Promise<DocumentLink> {
    const owned = await this.prisma.creditNote.count({
      where: { id, organizationId: me.organizationId, invoice: { customerId: me.customerId } },
    });
    if (owned !== 1) throw AppException.notFound('Credit note');
    return this.documents.creditNote(me.organizationId, id, { userId: null });
  }

  @Post('payments/:id/receipt')
  async paymentReceipt(
    @CurrentCustomer() me: CustomerPrincipal,
    @Param('id', uuidPipe) id: string,
  ): Promise<DocumentLink> {
    await this.payments.assertCustomerOwns(me.organizationId, me.customerId, id);
    return this.documents.paymentReceipt(me.organizationId, id, 'A4', { userId: null });
  }
}
