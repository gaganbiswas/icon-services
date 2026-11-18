import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import {
  AddAttachmentRequestSchema,
  AssignTechnicianRequestSchema,
  type CompletionRequest,
  CompletionRequestSchema,
  type DiagnosisRequest,
  DiagnosisRequestSchema,
  type JobWorkspace,
  type ReceiveDeviceRequest,
  ReceiveDeviceRequestSchema,
  type TransitionRequest,
  TransitionRequestSchema,
  type WorkLogRequest,
  WorkLogRequestSchema,
  type CreateJobRequest,
  CreateJobRequestSchema,
  type DocumentLink,
  type JobDetail,
  JobListQuerySchema,
  type JobSummary,
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
import { FilesService } from '../files/files.service.js';
import { requireIdempotencyKey } from '../idempotency/idempotency.service.js';
import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobsService } from './jobs.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const ListQuery = PaginationQuerySchema.extend(JobListQuerySchema.shape);
const ReceiptQuery = z.object({ layout: ReceiptLayoutSchema.default('A4') });
const UnassignQuery = z.object({ reason: z.string().trim().min(1).max(500) });

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly documents: DocumentsService,
    private readonly files: FilesService,
    private readonly lifecycle: JobLifecycleService,
  ) {}

  @Post()
  @RequirePermissions('jobs.create')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'Unique per intended job; retries reuse it',
  })
  async create(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodValidationPipe(CreateJobRequestSchema)) body: CreateJobRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<JobDetail> {
    const result = await this.jobs.createFromStaff(principal, body, requireIdempotencyKey(key));
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get()
  @RequirePermissions('jobs.read')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ): Promise<Page<JobSummary>> {
    return this.jobs.list(principal, query);
  }

  @Get(':id')
  @RequirePermissions('jobs.read')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<JobDetail> {
    return this.jobs.get(principal, id);
  }

  @Post(':id/receipt')
  @RequirePermissions('jobs.read')
  async receipt(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(ReceiptQuery)) query: z.infer<typeof ReceiptQuery>,
  ): Promise<DocumentLink> {
    await this.jobs.get(principal, id); // authorization + branch scope
    return this.documents.jobReceipt(principal.organizationId, id, query.layout, {
      userId: principal.userId,
    });
  }

  @Get(':id/attachments/:fileId/url')
  @RequirePermissions('jobs.read')
  async attachmentUrl(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Param('fileId', uuidPipe) fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string; expiresAt: string }> {
    const job = await this.jobs.get(principal, id);
    if (!job.attachments.some((a) => a.fileId === fileId)) throw AppException.notFound('File');
    res.setHeader('Cache-Control', 'no-store');
    return this.files.signedUrl(principal.organizationId, fileId);
  }

  // ------------------------------------------------ lifecycle & technician work (Phase 4)

  @Get(':id/workspace')
  @RequirePermissions('jobs.read')
  workspace(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<JobWorkspace> {
    return this.lifecycle.workspace(principal, id);
  }

  @Post(':id/status-transitions')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('jobs.transition')
  transition(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(TransitionRequestSchema)) body: TransitionRequest,
  ): Promise<JobDetail> {
    return this.lifecycle.transition(principal, id, body);
  }

  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('jobs.update')
  receive(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(ReceiveDeviceRequestSchema)) body: ReceiveDeviceRequest,
  ): Promise<JobDetail> {
    return this.lifecycle.receiveDevice(principal, id, body);
  }

  @Post(':id/completion')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('jobs.transition')
  complete(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(CompletionRequestSchema)) body: CompletionRequest,
  ): Promise<JobDetail> {
    return this.lifecycle.complete(principal, id, body);
  }

  @Get(':id/assignable-technicians')
  @RequirePermissions('jobs.assign')
  assignable(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<{ id: string; fullName: string }[]> {
    return this.lifecycle.assignableTechnicians(principal, id);
  }

  @Post(':id/assignments')
  @RequirePermissions('jobs.assign')
  assign(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(AssignTechnicianRequestSchema))
    body: z.infer<typeof AssignTechnicianRequestSchema>,
  ): Promise<JobWorkspace> {
    return this.lifecycle.assign(principal, id, body.technicianUserId, body.note);
  }

  @Delete(':id/assignments/:assignmentId')
  @RequirePermissions('jobs.assign')
  unassign(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Param('assignmentId', uuidPipe) assignmentId: string,
    @Query(new ZodValidationPipe(UnassignQuery)) query: z.infer<typeof UnassignQuery>,
  ): Promise<JobWorkspace> {
    return this.lifecycle.endAssignment(principal, id, assignmentId, query.reason);
  }

  @Post(':id/diagnoses')
  @RequirePermissions('diagnosis.write')
  addDiagnosis(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(DiagnosisRequestSchema)) body: DiagnosisRequest,
  ): Promise<JobWorkspace> {
    return this.lifecycle.addDiagnosis(principal, id, body);
  }

  @Post(':id/work-logs')
  @RequirePermissions('worklogs.write')
  addWorkLog(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(WorkLogRequestSchema)) body: WorkLogRequest,
  ): Promise<JobWorkspace> {
    return this.lifecycle.addWorkLog(principal, id, body);
  }

  @Post(':id/attachments')
  @RequirePermissions('worklogs.write')
  addAttachment(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(AddAttachmentRequestSchema))
    body: z.infer<typeof AddAttachmentRequestSchema>,
  ): Promise<JobDetail> {
    return this.lifecycle.addAttachment(principal, id, body);
  }
}
