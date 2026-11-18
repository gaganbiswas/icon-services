import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type ChangeConsentRequest,
  ChangeConsentRequestSchema,
  type Consent,
  type CreateCustomerRequest,
  CreateCustomerRequestSchema,
  type Customer,
  CustomerSearchQuerySchema,
  type Page,
  PaginationQuerySchema,
  type UpdateCustomerRequest,
  UpdateCustomerRequestSchema,
} from '@icon/contracts';
import type { z } from 'zod';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomersService } from './customers.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });
const ListQuery = PaginationQuerySchema.extend(CustomerSearchQuerySchema.shape);

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(ListQuery)) query: z.infer<typeof ListQuery>,
  ): Promise<Page<Customer>> {
    return this.customers.search(principal, query.q, query);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  get(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
  ): Promise<Customer> {
    return this.customers.get(principal.organizationId, id);
  }

  @Post()
  @RequirePermissions('customers.write')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateCustomerRequestSchema)) body: CreateCustomerRequest,
  ): Promise<Customer> {
    return this.customers.create(principal, body);
  }

  @Patch(':id')
  @RequirePermissions('customers.write')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdateCustomerRequestSchema)) body: UpdateCustomerRequest,
  ): Promise<Customer> {
    return this.customers.update(principal, id, body);
  }

  @Put(':id/consents')
  @RequirePermissions('customers.write')
  changeConsent(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(ChangeConsentRequestSchema)) body: ChangeConsentRequest,
  ): Promise<Consent[]> {
    return this.customers.changeConsent(principal.organizationId, id, body, {
      userId: principal.userId,
      source: 'STAFF_ENTRY',
    });
  }
}
