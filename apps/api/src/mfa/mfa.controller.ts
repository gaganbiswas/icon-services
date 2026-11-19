import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  MfaConfirmRequestSchema,
  type MfaEnrollment,
  MfaResetRequestSchema,
  type MfaStatus,
} from '@icon/contracts';
import type { Response } from 'express';
import type { z } from 'zod';

import type { Principal } from '../access/principal.js';
import {
  AllowPendingMfaEnrollment,
  CurrentPrincipal,
  RequirePermissions,
} from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MfaService } from './mfa.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

/** Own two-step sign-in set-up (ADR 0011). Reachable while enrolment is pending. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller()
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Get('auth/mfa')
  @AllowPendingMfaEnrollment()
  status(@CurrentPrincipal() principal: Principal): Promise<MfaStatus> {
    return this.mfa.status(principal);
  }

  @Post('auth/mfa/enrollment')
  @AllowPendingMfaEnrollment()
  @UseGuards(ThrottlerGuard)
  async start(
    @CurrentPrincipal() principal: Principal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MfaEnrollment> {
    res.setHeader('Cache-Control', 'no-store');
    return this.mfa.startEnrollment(principal);
  }

  @Post('auth/mfa/enrollment/confirm')
  @HttpCode(HttpStatus.OK)
  @AllowPendingMfaEnrollment()
  @UseGuards(ThrottlerGuard)
  async confirm(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(MfaConfirmRequestSchema))
    body: z.infer<typeof MfaConfirmRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ recoveryCodes: string[] }> {
    res.setHeader('Cache-Control', 'no-store');
    return this.mfa.confirmEnrollment(principal, body.code);
  }

  /** Lost phone: another administrator removes the user's MFA (audited, signs them out). */
  @Post('users/:id/mfa/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('users.manage')
  async reset(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(MfaResetRequestSchema)) body: z.infer<typeof MfaResetRequestSchema>,
  ): Promise<void> {
    await this.mfa.reset(principal, id, body.reason);
  }
}
