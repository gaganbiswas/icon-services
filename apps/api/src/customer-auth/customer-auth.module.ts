import { Global, Module } from '@nestjs/common';

import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerPrincipalLoader } from './customer-principal.loader.js';
import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { MetaWhatsAppClient } from '../notifications/meta-whatsapp.client.js';
import { MockOtpProvider, OTP_PROVIDER, type OtpProvider } from './otp-provider.js';
import { WhatsAppOtpProvider } from './whatsapp-otp.provider.js';

@Global()
@Module({
  controllers: [CustomerAuthController],
  providers: [
    MockOtpProvider,
    MetaWhatsAppClient,
    WhatsAppOtpProvider,
    {
      provide: OTP_PROVIDER,
      inject: [APP_ENV, MockOtpProvider, WhatsAppOtpProvider],
      useFactory: (env: Env, mock: MockOtpProvider, whatsapp: WhatsAppOtpProvider): OtpProvider =>
        env.OTP_PROVIDER === 'whatsapp' ? whatsapp : mock,
    },
    CustomerAuthService,
    CustomerPrincipalLoader,
  ],
  exports: [CustomerPrincipalLoader, OTP_PROVIDER, MockOtpProvider],
})
export class CustomerAuthModule {}
