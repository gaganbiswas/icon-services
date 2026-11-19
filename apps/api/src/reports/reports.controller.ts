import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type Dashboard,
  type DateRange,
  DateRangeSchema,
  type GstSummary,
  EXPORTABLE_REPORTS,
  ExportQuerySchema,
  type JobRegisterQuery,
  JobRegisterQuerySchema,
  type JobRegisterRow,
  type OutstandingReport,
  type Page,
  type PartsReport,
  PeriodSchema,
  type TechnicianPerformanceRow,
} from '@icon/contracts';
import type { Response } from 'express';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReportExportsService } from './report-exports.service.js';
import { ReportsService } from './reports.service.js';

const BranchQuery = z.object({ branchId: z.uuid().optional() });
const ReportParam = z.enum(EXPORTABLE_REPORTS);

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exportsService: ReportExportsService,
  ) {}

  @Get('dashboard')
  @RequirePermissions('reports.read')
  dashboard(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(BranchQuery)) q: z.infer<typeof BranchQuery>,
  ): Promise<Dashboard> {
    return this.reports.dashboard(principal, q.branchId);
  }

  @Get('jobs')
  @RequirePermissions('reports.read', 'jobs.read')
  jobs(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(JobRegisterQuerySchema)) q: JobRegisterQuery,
  ): Promise<Page<JobRegisterRow>> {
    return this.reports.jobRegister(principal, q);
  }

  @Get('technicians')
  @RequirePermissions('reports.read', 'jobs.read')
  technicians(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(PeriodSchema)) q: z.infer<typeof PeriodSchema>,
  ): Promise<TechnicianPerformanceRow[]> {
    return this.reports.technicians(principal, new Date(q.from), new Date(q.to), q.branchId);
  }

  @Get('parts')
  @RequirePermissions('reports.read', 'inventory.read')
  parts(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(PeriodSchema)) q: z.infer<typeof PeriodSchema>,
  ): Promise<PartsReport> {
    return this.reports.parts(principal, new Date(q.from), new Date(q.to), q.branchId);
  }

  @Get('outstanding')
  @RequirePermissions('reports.read', 'payments.read')
  outstanding(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(BranchQuery)) q: z.infer<typeof BranchQuery>,
  ): Promise<OutstandingReport> {
    return this.reports.outstanding(principal, q.branchId);
  }

  @Get('gst-summary')
  @RequirePermissions('reports.read', 'invoices.read')
  gstSummary(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(DateRangeSchema)) q: DateRange,
  ): Promise<GstSummary> {
    return this.reports.gstSummary(principal, q);
  }

  /** CSV / XLSX / PDF export. Needs reports.export plus the report's own read permission; audited. */
  @Get(':report/export')
  @RequirePermissions('reports.read', 'reports.export')
  async export(
    @CurrentPrincipal() principal: Principal,
    @Param('report', new ZodValidationPipe(ReportParam)) report: z.infer<typeof ReportParam>,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const { format } = new ZodValidationPipe(ExportQuerySchema).transform({
      format: query['format'],
    });
    const filters = Object.fromEntries(Object.entries(query).filter(([key]) => key !== 'format'));
    const file = await this.exportsService.export(principal, report, format, filters);
    res
      .status(200)
      .set({
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(file.body.length),
      })
      .end(file.body);
  }
}
