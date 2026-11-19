import { Module } from '@nestjs/common';

import { DocumentsModule } from '../documents/documents.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ReportExportsService } from './report-exports.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [DocumentsModule, PaymentsModule, InvoicesModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportExportsService],
})
export class ReportsModule {}
