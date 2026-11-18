import { Global, Module } from '@nestjs/common';

import { EstimateLinksController, EstimatesController } from './estimates.controller.js';
import { EstimatesService } from './estimates.service.js';

@Global()
@Module({
  controllers: [EstimatesController, EstimateLinksController],
  providers: [EstimatesService],
  exports: [EstimatesService],
})
export class EstimatesModule {}
