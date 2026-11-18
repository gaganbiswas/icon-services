import { Global, Module } from '@nestjs/common';

import { JobLifecycleService } from './job-lifecycle.service.js';
import { JobsController } from './jobs.controller.js';
import { JobsService } from './jobs.service.js';

@Global()
@Module({
  controllers: [JobsController],
  providers: [JobsService, JobLifecycleService],
  exports: [JobsService, JobLifecycleService],
})
export class JobsModule {}
