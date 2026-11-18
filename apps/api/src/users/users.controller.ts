import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type CreateUserRequest,
  CreateUserRequestSchema,
  type CreatedUserResponse,
  type Page,
  type PaginationQuery,
  PaginationQuerySchema,
  type PasswordSetupTokenResponse,
  type UpdateUserRequest,
  UpdateUserRequestSchema,
  type User,
} from '@icon/contracts';
import type { Response } from 'express';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { UsersService } from './users.service.js';

/** Unknown/malformed IDs are reported as 404, not 400, to avoid probing. */
const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(
    @CurrentPrincipal() principal: Principal,
    @Query(new ZodValidationPipe(PaginationQuerySchema)) query: PaginationQuery,
  ): Promise<Page<User>> {
    return this.users.list(principal, query);
  }

  @Get(':id')
  @RequirePermissions('users.read')
  get(@CurrentPrincipal() principal: Principal, @Param('id', uuidPipe) id: string): Promise<User> {
    return this.users.get(principal, id);
  }

  @Post()
  @RequirePermissions('users.manage')
  async create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateUserRequestSchema)) body: CreateUserRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CreatedUserResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.create(principal, body);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdateUserRequestSchema)) body: UpdateUserRequest,
  ): Promise<User> {
    return this.users.update(principal, id, body);
  }

  @Post(':id/password-setup')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('users.manage')
  async issuePasswordSetup(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PasswordSetupTokenResponse> {
    res.setHeader('Cache-Control', 'no-store');
    return this.users.issuePasswordSetup(principal, id);
  }
}
