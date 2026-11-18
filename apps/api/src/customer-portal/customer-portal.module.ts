import { Module } from '@nestjs/common';

import { CustomerPortalController } from './customer-portal.controller.js';
import { CustomerPortalService } from './customer-portal.service.js';

@Module({ controllers: [CustomerPortalController], providers: [CustomerPortalService] })
export class CustomerPortalModule {}
