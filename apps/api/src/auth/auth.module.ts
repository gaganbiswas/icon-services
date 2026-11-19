import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

import { AuditModule } from '../audit/audit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MeController } from './me.controller.js';
import { PasswordService } from './password.service.js';
import { PrincipalLoader } from './principal.loader.js';
import { MfaController } from '../mfa/mfa.controller.js';
import { MfaService } from '../mfa/mfa.service.js';
import { TokenService } from './token.service.js';

@Global()
@Module({
  imports: [
    AuditModule,
    // In-memory, per-process limits keyed by client IP. Move to Redis storage
    // before running more than one API instance.
    ThrottlerModule.forRootAsync({
      inject: [APP_ENV],
      useFactory: (env: Env) => ({
        throttlers: [{ name: 'auth', ttl: 60_000, limit: env.AUTH_RATE_LIMIT_PER_MINUTE }],
      }),
    }),
  ],
  controllers: [AuthController, MeController, MfaController],
  providers: [
    TokenService,
    PasswordService,
    PrincipalLoader,
    AuthService,
    MfaService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, PasswordService, TokenService],
})
export class AuthModule {}
