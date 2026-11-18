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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  type AccessTokenResponse,
  AccessTokenResponseSchema,
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
  type CompletePasswordSetupRequest,
  CompletePasswordSetupRequestSchema,
  ErrorResponseSchema,
  type LoginRequest,
  LoginRequestSchema,
} from '@icon/contracts';
import type { Request, Response } from 'express';

import type { Principal } from '../access/principal.js';
import { AppException } from '../common/app-exception.js';
import { toOpenApiSchema } from '../common/openapi.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './auth-cookie.js';
import { AuthService, type IssuedSession } from './auth.service.js';
import { assertCsrfSafe } from './csrf.js';
import { AllowPendingPasswordChange, CurrentPrincipal, Public } from './decorators.js';

const tokenSchema = toOpenApiSchema(AccessTokenResponseSchema);
const errorSchema = toOpenApiSchema(ErrorResponseSchema);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({ summary: 'Staff sign-in. Sets the refresh cookie; returns an access token.' })
  @ApiResponse({ status: 200, schema: tokenSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    return this.respond(res, await this.auth.login(body.email, body.password));
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the refresh cookie and issue a new access token. Requires X-ICON-CSRF: 1.',
  })
  @ApiResponse({ status: 200, schema: tokenSchema })
  @ApiResponse({ status: 401, schema: errorSchema })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    assertCsrfSafe(req, this.env.API_CORS_ORIGINS);
    const token = readRefreshCookie(req);
    if (!token) {
      throw AppException.unauthenticated('Session expired. Sign in again.');
    }
    try {
      return this.respond(res, await this.auth.refresh(token));
    } catch (error) {
      clearRefreshCookie(res, this.env.AUTH_COOKIE_SECURE);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke the current session and clear the refresh cookie. Requires X-ICON-CSRF: 1.',
  })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    assertCsrfSafe(req, this.env.API_CORS_ORIGINS);
    await this.auth.logout(readRefreshCookie(req));
    clearRefreshCookie(res, this.env.AUTH_COOKIE_SECURE);
  }

  @Post('password/change')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AllowPendingPasswordChange()
  @UseGuards(ThrottlerGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change own password. Signs out other sessions.' })
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(ChangePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(principal, body.currentPassword, body.newPassword);
  }

  @Public()
  @Post('password-setup/complete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(ThrottlerGuard)
  @ApiOperation({
    summary: 'Set a password using a one-time set-up token issued by an administrator.',
  })
  async completePasswordSetup(
    @Body(new ZodValidationPipe(CompletePasswordSetupRequestSchema))
    body: CompletePasswordSetupRequest,
  ): Promise<void> {
    await this.auth.completePasswordSetup(body.token, body.newPassword);
  }

  private respond(res: Response, issued: IssuedSession): AccessTokenResponse {
    setRefreshCookie(
      res,
      issued.refreshToken,
      issued.refreshExpiresAt,
      this.env.AUTH_COOKIE_SECURE,
    );
    res.setHeader('Cache-Control', 'no-store');
    return issued.response;
  }
}
