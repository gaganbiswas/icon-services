import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SETTING_KEYS, type SettingKey } from '@icon/contracts';
import { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SettingsService } from './settings.service.js';

const UpdateSettingSchema = z.object({
  value: z.unknown(),
  reason: z.string().trim().min(1).max(500),
});

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermissions('settings.read')
  list(@CurrentPrincipal() principal: Principal): Promise<Record<string, unknown>> {
    return this.settings.list(principal.organizationId);
  }

  @Put(':key')
  @RequirePermissions('settings.manage')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(UpdateSettingSchema)) body: z.infer<typeof UpdateSettingSchema>,
  ): Promise<unknown> {
    if (!(SETTING_KEYS as string[]).includes(key)) {
      throw AppException.notFound('Setting');
    }
    return this.settings.set(principal, key as SettingKey, body.value, body.reason);
  }
}
