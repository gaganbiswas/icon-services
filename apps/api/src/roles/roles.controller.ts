import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  type CreateRoleRequest,
  CreateRoleRequestSchema,
  type PermissionCode,
  type Role,
  type UpdateRoleRequest,
  UpdateRoleRequestSchema,
} from '@icon/contracts';

import type { Principal } from '../access/principal.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import { AppException } from '../common/app-exception.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RolesService } from './roles.service.js';

const uuidPipe = new ParseUUIDPipe({ exceptionFactory: () => AppException.notFound() });

@ApiTags('roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermissions('roles.read')
  permissions(): { code: PermissionCode; description: string }[] {
    return this.roles.listPermissions();
  }

  @Get('roles')
  @RequirePermissions('roles.read')
  list(@CurrentPrincipal() principal: Principal): Promise<Role[]> {
    return this.roles.list(principal);
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateRoleRequestSchema)) body: CreateRoleRequest,
  ): Promise<Role> {
    return this.roles.create(principal, body);
  }

  @Patch('roles/:id')
  @RequirePermissions('roles.manage')
  update(
    @CurrentPrincipal() principal: Principal,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(UpdateRoleRequestSchema)) body: UpdateRoleRequest,
  ): Promise<Role> {
    return this.roles.update(principal, id, body);
  }
}
