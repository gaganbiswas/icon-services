import { Global, Module } from '@nestjs/common';

import { CustomerAuthController } from './customer-auth.controller.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { CustomerPrincipalLoader } from './customer-principal.loader.js';
import { MockOtpProvider, OTP_PROVIDER } from './otp-provider.js';

@Global()
@Module({
  controllers: [CustomerAuthController],
  providers: [
    MockOtpProvider,
    { provide: OTP_PROVIDER, useExisting: MockOtpProvider },
    CustomerAuthService,
    CustomerPrincipalLoader,
  ],
  exports: [CustomerPrincipalLoader, OTP_PROVIDER, MockOtpProvider],
})
export class CustomerAuthModule {}
