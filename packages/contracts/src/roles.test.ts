import { describe, expect, it } from 'vitest';

import { PERMISSION_CODES, isPermissionCode } from './permissions.js';
import { SYSTEM_ROLES, SYSTEM_ROLE_CODES } from './roles.js';

describe('permission catalogue', () => {
  it('uses unique, dotted lower-case codes', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const code of PERMISSION_CODES) {
      expect(code).toMatch(/^[a-z_]+(\.[a-z_]+)+$/);
    }
  });

  it('recognises known codes only', () => {
    expect(isPermissionCode('users.read')).toBe(true);
    expect(isPermissionCode('users.delete_everything')).toBe(false);
    expect(isPermissionCode('toString')).toBe(false);
  });
});

describe('system roles', () => {
  const byCode = new Map(SYSTEM_ROLES.map((role) => [role.code, role]));

  it('defines every system role exactly once', () => {
    expect(SYSTEM_ROLES.map((role) => role.code).sort()).toEqual([...SYSTEM_ROLE_CODES].sort());
  });

  it('lists each permission at most once per role', () => {
    for (const role of SYSTEM_ROLES) {
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('only references catalogue permissions', () => {
    for (const role of SYSTEM_ROLES) {
      for (const permission of role.permissions) {
        expect(isPermissionCode(permission)).toBe(true);
      }
    }
  });

  it('gives Super Admin every permission', () => {
    expect([...(byCode.get('SUPER_ADMIN')?.permissions ?? [])].sort()).toEqual(
      [...PERMISSION_CODES].sort(),
    );
  });

  it('keeps privileged administration away from branch admins', () => {
    const branchAdmin = byCode.get('BRANCH_ADMIN')?.permissions ?? [];
    expect(branchAdmin).not.toContain('roles.manage');
    expect(branchAdmin).not.toContain('branches.all');
    expect(branchAdmin).not.toContain('settings.manage');
  });

  it('keeps customers and auditors from writing anything', () => {
    expect(byCode.get('CUSTOMER')?.permissions).toEqual([]);
    const auditor = byCode.get('AUDITOR')?.permissions ?? [];
    expect(auditor.every((p) => p.endsWith('.read'))).toBe(true);
    expect(auditor).toContain('audit.read');
  });

  it('keeps technician notes away from reception', () => {
    expect(byCode.get('RECEPTION')?.permissions).not.toContain('jobs.internal_notes.read');
  });
});
