import { Global, Module } from '@nestjs/common';

import { NumberingService } from '../numbering/numbering.service.js';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService, NumberingService],
  exports: [SettingsService, NumberingService],
})
export class SettingsModule {}
