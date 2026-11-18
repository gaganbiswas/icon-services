import { z } from 'zod';

import { BranchSummarySchema, EmailSchema, RoleSummarySchema } from './auth.js';
import { PERMISSION_CODES } from './permissions.js';

export const UserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  fullName: z.string(),
  isActive: z.boolean(),
  isLocked: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  roles: z.array(RoleSummarySchema),
  branches: z.array(BranchSummarySchema),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type User = z.infer<typeof UserSchema>;

const FullNameSchema = z.string().trim().min(1).max(200);

export const CreateUserRequestSchema = z.object({
  email: EmailSchema,
  fullName: FullNameSchema,
  roleIds: z.array(z.uuid()).max(20).default([]),
  branchIds: z.array(z.uuid()).max(200).default([]),
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z
  .object({
    version: z.number().int().min(1),
    fullName: FullNameSchema.optional(),
    isActive: z.boolean().optional(),
    roleIds: z.array(z.uuid()).max(20).optional(),
    branchIds: z.array(z.uuid()).max(200).optional(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .refine((value) => value.isActive !== false || value.reason !== undefined, {
    message: 'A reason is required when deactivating a user',
    path: ['reason'],
  });
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const CreatedUserResponseSchema = z.object({
  user: UserSchema,
  passwordSetup: z.object({ token: z.string(), expiresAt: z.iso.datetime() }),
});
export type CreatedUserResponse = z.infer<typeof CreatedUserResponseSchema>;

const PermissionCodeSchema = z.enum(PERMISSION_CODES as [string, ...string[]]);

export const RoleSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(PermissionCodeSchema),
  version: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;

const RoleCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'Use upper-case letters, digits and underscores');

export const CreateRoleRequestSchema = z.object({
  code: RoleCodeSchema,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  permissions: z.array(PermissionCodeSchema).max(200).default([]),
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  permissions: z.array(PermissionCodeSchema).max(200).optional(),
  reason: z.string().trim().min(1).max(500),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const PermissionSchema = z.object({
  code: PermissionCodeSchema,
  description: z.string(),
});

export const BranchSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  timezone: z.string().nullable(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const AuditLogSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorUserId: z.uuid().nullable(),
  actorType: z.enum(['USER', 'SYSTEM', 'ANONYMOUS']),
  branchId: z.uuid().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditLogQuerySchema = z.object({
  entityType: z.string().max(100).optional(),
  entityId: z.string().max(100).optional(),
  actorUserId: z.uuid().optional(),
  action: z.string().max(100).optional(),
});
export type AuditLogQuery = z.infer<typeof AuditLogQuerySchema>;
