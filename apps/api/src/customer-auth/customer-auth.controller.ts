import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  CustomerRefreshRequestSchema,
  type CustomerTokenResponse,
  type OtpRequest,
  OtpRequestSchema,
  type OtpVerifyRequest,
  OtpVerifyRequestSchema,
} from '@icon/contracts';
import type { Response } from 'express';
import type { z } from 'zod';

import { Public } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomerAuthService } from './customer-auth.service.js';

/**
 * Customer sign-in for the Android app / portal (ADR 0012). Tokens are returned
 * in the body (no cookies); the app stores the refresh token in secure storage.
 */
@ApiTags('customer-auth')
@Controller('customer/auth')
@Public()
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  requestCode(@Body(new ZodValidationPipe(OtpRequestSchema)) body: OtpRequest) {
    return this.auth.requestCode(body.organizationCode, body.phone);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async verify(
    @Body(new ZodValidationPipe(OtpVerifyRequestSchema)) body: OtpVerifyRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerTokenResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.verifyCode(body.organizationCode, body.phone, body.code, body.fullName);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(CustomerRefreshRequestSchema))
    body: z.infer<typeof CustomerRefreshRequestSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerTokenResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(CustomerRefreshRequestSchema))
    body: z.infer<typeof CustomerRefreshRequestSchema>,
  ): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }
}
