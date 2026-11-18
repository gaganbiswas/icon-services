import { Global, Module } from '@nestjs/common';

import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

@Global()
@Module({
  controllers: [CustomersController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
