import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  CustomerRefreshRequestSchema,
  type CustomerTokenResponse,
  type CustomerWebTokenResponse,
  type OtpRequest,
  OtpRequestSchema,
  type OtpVerifyRequest,
  OtpVerifyRequestSchema,
} from '@icon/contracts';
import type { Request, Response } from 'express';
import type { z } from 'zod';

import {
  clearCustomerWebCookie,
  readCustomerWebCookie,
  setCustomerWebCookie,
} from '../auth/auth-cookie.js';
import { assertCsrfSafe } from '../auth/csrf.js';
import { Public } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomerAuthService } from './customer-auth.service.js';

/**
 * Customer sign-in (ADR 0012). The Android app gets tokens in the body and keeps
 * the refresh token in secure storage; the web portal uses the /web/* variants,
 * where the refresh token lives only in an HttpOnly cookie (CLAUDE.md §8).
 */
@ApiTags('customer-auth')
@Controller('customer/auth')
@Public()
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

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

  // ---------------------------------------------------------------- web portal (cookie sessions)

  @Post('web/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async webVerify(
    @Body(new ZodValidationPipe(OtpVerifyRequestSchema)) body: OtpVerifyRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerWebTokenResponse> {
    const tokens = await this.auth.verifyCode(
      body.organizationCode,
      body.phone,
      body.code,
      body.fullName,
    );
    return this.webRespond(res, tokens);
  }

  @Post('web/refresh')
  @HttpCode(HttpStatus.OK)
  async webRefresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CustomerWebTokenResponse> {
    assertCsrfSafe(req, this.env.API_CORS_ORIGINS);
    const token = readCustomerWebCookie(req);
    if (!token) throw AppException.unauthenticated('Session expired. Sign in again.');
    try {
      return this.webRespond(res, await this.auth.refresh(token));
    } catch (error) {
      clearCustomerWebCookie(res, this.env.AUTH_COOKIE_SECURE);
      throw error;
    }
  }

  @Post('web/logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async webLogout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    assertCsrfSafe(req, this.env.API_CORS_ORIGINS);
    const token = readCustomerWebCookie(req);
    if (token) await this.auth.logout(token);
    clearCustomerWebCookie(res, this.env.AUTH_COOKIE_SECURE);
  }

  private webRespond(res: Response, tokens: CustomerTokenResponse): CustomerWebTokenResponse {
    setCustomerWebCookie(
      res,
      tokens.refreshToken,
      new Date(tokens.refreshExpiresAt),
      this.env.AUTH_COOKIE_SECURE,
    );
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
      refreshExpiresAt: tokens.refreshExpiresAt,
    };
  }
}
