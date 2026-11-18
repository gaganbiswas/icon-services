import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type OrgFixture,
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  resetDatabase,
} from './integration/harness.js';

interface ErrorBody {
  error: { code: string };
}
interface UserBody {
  id: string;
  version: number;
  roles: { code: string }[];
  branches: { code: string }[];
  isActive: boolean;
}

/**
 * Authorization matrix: roles, organization isolation, branch scope and
 * privilege-escalation guards (CLAUDE.md §2, §9; ADR 0010).
 */
describe('Access control (real PostgreSQL)', () => {
  let t: TestApp;
  let orgA: OrgFixture;
  let orgB: OrgFixture;
  const ids: Record<string, string> = {};
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    orgA = await createOrg(t.prisma, 'ORGA', ['A1', 'A2']);
    orgB = await createOrg(t.prisma, 'ORGB', ['B1']);
    const people: [string, OrgFixture, string[], string[]][] = [
      ['superA', orgA, ['SUPER_ADMIN'], []],
      ['branchAdminA1', orgA, ['BRANCH_ADMIN'], ['A1']],
      ['receptionA1', orgA, ['RECEPTION'], ['A1']],
      ['technicianA2', orgA, ['TECHNICIAN'], ['A2']],
      ['auditorA', orgA, ['AUDITOR'], ['A1', 'A2']],
      ['superB', orgB, ['SUPER_ADMIN'], []],
      ['receptionB1', orgB, ['RECEPTION'], ['B1']],
    ];
    for (const [key, org, roles, branches] of people) {
      const user = await createUser(t.prisma, org, {
        email: `${key.toLowerCase()}@test.example`,
        roles,
        branches,
      });
      ids[key] = user.id;
    }
    for (const key of ['superA', 'branchAdminA1', 'receptionA1', 'auditorA', 'superB']) {
      tokens[key] = (await login(t, `${key.toLowerCase()}@test.example`)).accessToken;
    }
  });

  const http = () => request(t.server());
  const as = (key: string) => bearer(tokens[key] ?? '');

  describe('permission checks', () => {
    it.each([
      ['receptionA1', 'get', '/api/v1/users'],
      ['receptionA1', 'get', '/api/v1/roles'],
      ['receptionA1', 'get', '/api/v1/audit-logs'],
      ['receptionA1', 'post', '/api/v1/users'],
      ['branchAdminA1', 'post', '/api/v1/roles'],
      ['auditorA', 'post', '/api/v1/users'],
    ] as const)('%s cannot %s %s', async (who, method, url) => {
      const response = await http()[method](url).set(as(who)).send({});
      expect(response.status).toBe(403);
      expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('lets the auditor read the audit log and users', async () => {
      await http().get('/api/v1/audit-logs').set(as('auditorA')).expect(200);
      await http().get('/api/v1/users').set(as('auditorA')).expect(200);
    });

    it('applies role changes on the next request without re-login', async () => {
      await http().get('/api/v1/branches').set(as('receptionA1')).expect(200);
      await t.prisma.userRole.deleteMany({ where: { userId: ids['receptionA1'] } });
      await http().get('/api/v1/branches').set(as('receptionA1')).expect(403);
    });
  });

  describe('organization isolation (IDOR)', () => {
    it('hides other organizations’ users, branches and roles as 404', async () => {
      await http().get(`/api/v1/users/${ids['receptionB1']}`).set(as('superA')).expect(404);
      await http().get(`/api/v1/branches/${orgB.branches['B1']}`).set(as('superA')).expect(404);
      await http()
        .patch(`/api/v1/users/${ids['receptionB1']}`)
        .set(as('superA'))
        .send({ version: 1, fullName: 'Hijacked' })
        .expect(404);
      await http()
        .patch(`/api/v1/roles/${orgB.roles['RECEPTION']}`)
        .set(as('superA'))
        .send({ version: 1, name: 'x', reason: 'test' })
        .expect(404);
      await http()
        .post(`/api/v1/users/${ids['receptionB1']}/password-setup`)
        .set(as('superA'))
        .expect(404);

      const list = await http().get('/api/v1/users?pageSize=100').set(as('superA')).expect(200);
      const listed = (list.body as { items: { id: string }[] }).items.map((u) => u.id);
      expect(listed).not.toContain(ids['receptionB1']);
      expect(listed).not.toContain(ids['superB']);

      const roles = await http().get('/api/v1/roles').set(as('superA')).expect(200);
      expect((roles.body as { id: string }[]).map((r) => r.id)).not.toContain(
        orgB.roles['RECEPTION'],
      );
    });

    it('refuses to assign another organization’s roles or branches', async () => {
      await http()
        .post('/api/v1/users')
        .set(as('superA'))
        .send({ email: 'x@test.example', fullName: 'X', roleIds: [orgB.roles['RECEPTION']] })
        .expect(404);
      await http()
        .post('/api/v1/users')
        .set(as('superA'))
        .send({ email: 'y@test.example', fullName: 'Y', branchIds: [orgB.branches['B1']] })
        .expect(404);
    });

    it('treats malformed IDs as not found', async () => {
      await http().get('/api/v1/users/not-a-uuid').set(as('superA')).expect(404);
    });
  });

  describe('branch scope', () => {
    it('limits branch admins to their own branches', async () => {
      const branches = await http().get('/api/v1/branches').set(as('branchAdminA1')).expect(200);
      expect((branches.body as { code: string }[]).map((b) => b.code)).toEqual(['A1']);
      await http()
        .get(`/api/v1/branches/${orgA.branches['A2']}`)
        .set(as('branchAdminA1'))
        .expect(404);

      const users = await http()
        .get('/api/v1/users?pageSize=100')
        .set(as('branchAdminA1'))
        .expect(200);
      const visible = (users.body as { items: { id: string }[] }).items.map((u) => u.id);
      expect(visible).toContain(ids['receptionA1']);
      expect(visible).not.toContain(ids['technicianA2']);
      await http().get(`/api/v1/users/${ids['technicianA2']}`).set(as('branchAdminA1')).expect(404);
    });

    it('gives Super Admin every branch', async () => {
      const branches = await http().get('/api/v1/branches').set(as('superA')).expect(200);
      expect((branches.body as { code: string }[]).map((b) => b.code)).toEqual(['A1', 'A2']);
    });

    it('filters the audit log by branch for branch-scoped readers', async () => {
      await t.prisma.auditLog.create({
        data: {
          organizationId: orgA.id,
          branchId: orgA.branches['A2'],
          actorType: 'SYSTEM',
          action: 'test.a2',
          entityType: 'test',
        },
      });
      await t.prisma.auditLog.create({
        data: {
          organizationId: orgB.id,
          actorType: 'SYSTEM',
          action: 'test.orgb',
          entityType: 'test',
        },
      });
      const scoped = await http()
        .get('/api/v1/audit-logs?pageSize=100')
        .set(as('branchAdminA1'))
        .expect(200);
      const actions = (scoped.body as { items: { action: string }[] }).items.map((a) => a.action);
      expect(actions).not.toContain('test.a2');
      expect(actions).not.toContain('test.orgb');
      const all = await http().get('/api/v1/audit-logs?pageSize=100').set(as('superA')).expect(200);
      const allActions = (all.body as { items: { action: string }[] }).items.map((a) => a.action);
      expect(allActions).toContain('test.a2');
      expect(allActions).not.toContain('test.orgb');
    });
  });

  describe('privilege escalation', () => {
    it('blocks assigning roles with permissions the actor lacks', async () => {
      const response = await http()
        .post('/api/v1/users')
        .set(as('branchAdminA1'))
        .send({
          email: 'evil@test.example',
          fullName: 'Evil',
          roleIds: [orgA.roles['SUPER_ADMIN']],
          branchIds: [orgA.branches['A1']],
        })
        .expect(403);
      expect((response.body as ErrorBody).error.code).toBe('FORBIDDEN');
    });

    it('blocks granting branches outside the actor’s scope', async () => {
      await http()
        .post('/api/v1/users')
        .set(as('branchAdminA1'))
        .send({
          email: 'z@test.example',
          fullName: 'Z',
          roleIds: [orgA.roles['RECEPTION']],
          branchIds: [orgA.branches['A2']],
        })
        .expect(403);
    });

    it('allows branch admins to create staff within their scope', async () => {
      const response = await http()
        .post('/api/v1/users')
        .set(as('branchAdminA1'))
        .send({
          email: 'Desk@Test.Example',
          fullName: 'Front Desk',
          roleIds: [orgA.roles['RECEPTION']],
          branchIds: [orgA.branches['A1']],
        })
        .expect(201);
      const body = response.body as { user: UserBody };
      expect(body.user.roles.map((r) => r.code)).toEqual(['RECEPTION']);
      expect(body.user.branches.map((b) => b.code)).toEqual(['A1']);

      const duplicate = await http()
        .post('/api/v1/users')
        .set(as('branchAdminA1'))
        .send({ email: 'desk@test.example', fullName: 'Again' })
        .expect(409);
      expect((duplicate.body as ErrorBody).error.code).toBe('CONFLICT');
    });

    it('blocks managing a user who holds permissions the actor lacks', async () => {
      const privileged = await createUser(t.prisma, orgA, {
        email: 'privileged@test.example',
        roles: ['SUPER_ADMIN'],
        branches: ['A1'],
      });
      await http()
        .patch(`/api/v1/users/${privileged.id}`)
        .set(as('branchAdminA1'))
        .send({ version: 1, isActive: false, reason: 'test' })
        .expect(403);
      await http()
        .post(`/api/v1/users/${privileged.id}/password-setup`)
        .set(as('branchAdminA1'))
        .expect(403);
    });

    it('preserves branch access the actor does not manage', async () => {
      const shared = await createUser(t.prisma, orgA, {
        email: 'shared@test.example',
        roles: ['RECEPTION'],
        branches: ['A1', 'A2'],
      });
      const response = await http()
        .patch(`/api/v1/users/${shared.id}`)
        .set(as('branchAdminA1'))
        .send({ version: 1, branchIds: [] })
        .expect(200);
      expect((response.body as UserBody).branches.map((b) => b.code)).toEqual(['A2']);
    });

    it('blocks changing your own access', async () => {
      await http()
        .patch(`/api/v1/users/${ids['superA']}`)
        .set(as('superA'))
        .send({ version: 1, isActive: false, reason: 'oops' })
        .expect(403);
      await http()
        .patch(`/api/v1/users/${ids['branchAdminA1']}`)
        .set(as('branchAdminA1'))
        .send({ version: 1, roleIds: [orgA.roles['SUPER_ADMIN']] })
        .expect(403);
    });

    it('locks the Super Admin permission set and limits role edits to held permissions', async () => {
      const roles = await http().get('/api/v1/roles').set(as('superA')).expect(200);
      const superRole = (roles.body as { code: string; version: number; id: string }[]).find(
        (r) => r.code === 'SUPER_ADMIN',
      );
      await http()
        .patch(`/api/v1/roles/${superRole?.id}`)
        .set(as('superA'))
        .send({ version: superRole?.version, permissions: ['users.read'], reason: 'test' })
        .expect(403);

      const created = await http()
        .post('/api/v1/roles')
        .set(as('superA'))
        .send({
          code: 'FRONT_DESK_LEAD',
          name: 'Front desk lead',
          permissions: ['jobs.read', 'customers.read'],
        })
        .expect(201);
      const role = created.body as { id: string; version: number };
      const updated = await http()
        .patch(`/api/v1/roles/${role.id}`)
        .set(as('superA'))
        .send({ version: role.version, permissions: ['jobs.read'], reason: 'Narrow access' })
        .expect(200);
      expect(updated.body).toMatchObject({ permissions: ['jobs.read'], version: 2 });

      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'role.updated', entityId: role.id },
      });
      expect(audit.reason).toBe('Narrow access');
      expect(audit.before).toMatchObject({ permissions: ['customers.read', 'jobs.read'] });
    });
  });

  describe('user lifecycle', () => {
    it('detects concurrent edits with the version field', async () => {
      const first = await http()
        .patch(`/api/v1/users/${ids['receptionA1']}`)
        .set(as('superA'))
        .send({ version: 1, fullName: 'Renamed' })
        .expect(200);
      expect((first.body as UserBody).version).toBe(2);
      const stale = await http()
        .patch(`/api/v1/users/${ids['receptionA1']}`)
        .set(as('superA'))
        .send({ version: 1, fullName: 'Stale write' })
        .expect(409);
      expect((stale.body as ErrorBody).error.code).toBe('VERSION_CONFLICT');
    });

    it('requires a reason to deactivate, revokes sessions immediately, and audits it', async () => {
      await http()
        .patch(`/api/v1/users/${ids['receptionA1']}`)
        .set(as('superA'))
        .send({ version: 1, isActive: false })
        .expect(400);
      await http()
        .patch(`/api/v1/users/${ids['receptionA1']}`)
        .set(as('superA'))
        .send({ version: 1, isActive: false, reason: 'Left the company' })
        .expect(200);
      await http().get('/api/v1/me').set(as('receptionA1')).expect(401);

      const audit = await t.prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.deactivated' },
      });
      expect(audit).toMatchObject({
        actorUserId: ids['superA'],
        entityId: ids['receptionA1'],
        reason: 'Left the company',
      });
      expect(audit.before).toMatchObject({ isActive: true });
      expect(audit.after).toMatchObject({ isActive: false });
    });

    it('paginates with bounded page size', async () => {
      const page = await http()
        .get('/api/v1/users?page=1&pageSize=2')
        .set(as('superA'))
        .expect(200);
      expect(page.body).toMatchObject({ page: 1, pageSize: 2, total: 5 });
      expect((page.body as { items: unknown[] }).items).toHaveLength(2);
      await http().get('/api/v1/users?pageSize=1000').set(as('superA')).expect(400);
    });
  });
});
