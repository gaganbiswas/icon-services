import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ORIGIN,
  PASSWORD,
  type OrgFixture,
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  refreshCookieFrom,
  resetDatabase,
} from './integration/harness.js';

const CSRF = { 'X-ICON-CSRF': '1', Origin: ORIGIN };

interface ErrorBody {
  error: { code: string; message: string; requestId?: string };
}

describe('Staff authentication (real PostgreSQL)', () => {
  let t: TestApp;
  let org: OrgFixture;
  let admin: { id: string; email: string };

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1']);
    admin = await createUser(t.prisma, org, {
      email: 'admin@a.test',
      roles: ['SUPER_ADMIN'],
      branches: ['A1'],
    });
  });

  const http = () => request(t.server());

  describe('login', () => {
    it('issues an access token and a hardened refresh cookie', async () => {
      const result = await login(t, 'ADMIN@a.test ');
      expect(result.accessToken.split('.')).toHaveLength(3);
      const header = result.setCookieHeader.toLowerCase();
      expect(header).toContain('httponly');
      expect(header).toContain('samesite=strict');
      expect(header).toContain('path=/api/v1/auth');

      const me = await http().get('/api/v1/me').set(bearer(result.accessToken)).expect(200);
      expect(me.body).toMatchObject({
        id: admin.id,
        email: 'admin@a.test',
        branchAccess: 'ALL',
        mustChangePassword: false,
      });
      expect((me.body as { permissions: string[] }).permissions).toContain('roles.manage');

      const audit = await t.prisma.auditLog.findFirst({
        where: { action: 'auth.login.succeeded' },
      });
      expect(audit).toMatchObject({ actorUserId: admin.id, entityId: admin.id });
      expect(audit?.requestId).toBeTruthy();
    });

    it('returns the same generic error for unknown e-mail and wrong password', async () => {
      const unknown = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@a.test', password: PASSWORD })
        .expect(401);
      const wrong = await http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: 'wrong-password-123' })
        .expect(401);
      expect((unknown.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
      expect((unknown.body as ErrorBody).error.message).toBe(
        (wrong.body as ErrorBody).error.message,
      );
      expect(unknown.headers['set-cookie']).toBeUndefined();
    });

    it('locks the account after repeated failures, even for the correct password', async () => {
      for (let i = 0; i < t.env.LOGIN_MAX_FAILED_ATTEMPTS; i += 1) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email: admin.email, password: `wrong-${i}-xxxxxx` })
          .expect(401);
      }
      await http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(401);

      const user = await t.prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(user.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(await t.prisma.auditLog.count({ where: { action: 'auth.account.locked' } })).toBe(1);
    });

    it('rejects inactive users and users without a password', async () => {
      await createUser(t.prisma, org, { email: 'inactive@a.test', isActive: false });
      await createUser(t.prisma, org, { email: 'pending@a.test', password: null });
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'inactive@a.test', password: PASSWORD })
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'pending@a.test', password: PASSWORD })
        .expect(401);
    });

    it('validates the request body with the standard error envelope', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
      const body = response.body as ErrorBody & { error: { details: { path: string }[] } };
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details.map((d) => d.path)).toEqual(
        expect.arrayContaining(['email', 'password']),
      );
      expect(body.error.requestId).toBe(response.headers['x-request-id']);
    });
  });

  describe('access tokens', () => {
    it('rejects missing, malformed, forged and wrong-audience tokens', async () => {
      await http().get('/api/v1/me').expect(401);
      await http().get('/api/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);

      const { accessToken } = await login(t, admin.email);
      const [header, payload] = accessToken.split('.');
      await http()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${header}.${payload}.forged`)
        .expect(401);

      const session = await t.prisma.authSession.findFirstOrThrow({ where: { userId: admin.id } });
      const otherKey = new TextEncoder().encode('some-other-secret-0123456789-abcdefghijkl');
      const foreign = await new SignJWT({ sid: session.id, org: org.id })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(admin.id)
        .setIssuer(t.env.JWT_ISSUER)
        .setAudience(t.env.JWT_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(otherKey);
      await http().get('/api/v1/me').set(bearer(foreign)).expect(401);

      const rightKey = new TextEncoder().encode(t.env.JWT_ACCESS_SECRET);
      const wrongAudience = await new SignJWT({ sid: session.id, org: org.id })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(admin.id)
        .setIssuer(t.env.JWT_ISSUER)
        .setAudience('customer-app')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(rightKey);
      await http().get('/api/v1/me').set(bearer(wrongAudience)).expect(401);

      const expired = await new SignJWT({ sid: session.id, org: org.id })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(admin.id)
        .setIssuer(t.env.JWT_ISSUER)
        .setAudience(t.env.JWT_AUDIENCE)
        .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
        .sign(rightKey);
      await http().get('/api/v1/me').set(bearer(expired)).expect(401);
    });
  });

  describe('refresh rotation', () => {
    it('rotates the refresh token and detects reuse by revoking the session', async () => {
      const first = await login(t, admin.email);

      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set(CSRF)
        .set('Cookie', first.cookie)
        .expect(200);
      const second = refreshCookieFrom(rotated.headers['set-cookie']).pair;
      expect(second).not.toBe(first.cookie);
      const newAccess = (rotated.body as { accessToken: string }).accessToken;
      await http().get('/api/v1/me').set(bearer(newAccess)).expect(200);

      // Replaying the first (already used) token = theft signal.
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', first.cookie).expect(401);

      // Whole family is revoked: the legitimate newer token and access token die too.
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', second).expect(401);
      await http().get('/api/v1/me').set(bearer(newAccess)).expect(401);

      const session = await t.prisma.authSession.findFirstOrThrow({ where: { userId: admin.id } });
      expect(session.revokedReason).toBe('REFRESH_TOKEN_REUSE');
      expect(
        await t.prisma.auditLog.count({ where: { action: 'auth.refresh_token.reuse_detected' } }),
      ).toBe(1);
    });

    it('requires the CSRF header and an allowed origin', async () => {
      const { cookie } = await login(t, admin.email);
      const noHeader = await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(403);
      expect((noHeader.body as ErrorBody).error.code).toBe('CSRF_REJECTED');
      await http()
        .post('/api/v1/auth/refresh')
        .set({ 'X-ICON-CSRF': '1', Origin: 'https://evil.example' })
        .set('Cookie', cookie)
        .expect(403);
      // Rejected attempts must not consume the token.
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie).expect(200);
    });

    it('rejects refresh without a cookie', async () => {
      await http().post('/api/v1/auth/refresh').set(CSRF).expect(401);
    });

    it('stops refreshing after the user is deactivated', async () => {
      const { cookie } = await login(t, admin.email);
      await t.prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie).expect(401);
    });
  });

  describe('logout', () => {
    it('revokes the session immediately and clears the cookie', async () => {
      const { accessToken, cookie } = await login(t, admin.email);
      const response = await http()
        .post('/api/v1/auth/logout')
        .set(CSRF)
        .set('Cookie', cookie)
        .expect(204);
      expect(String(response.headers['set-cookie'])).toMatch(/icon_rt=;/);
      await http().get('/api/v1/me').set(bearer(accessToken)).expect(401);
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie).expect(401);
      // Idempotent.
      await http().post('/api/v1/auth/logout').set(CSRF).set('Cookie', cookie).expect(204);
    });
  });

  describe('password change', () => {
    it('changes the password and signs out other sessions only', async () => {
      const current = await login(t, admin.email);
      const other = await login(t, admin.email);

      const wrong = await http()
        .post('/api/v1/auth/password/change')
        .set(bearer(current.accessToken))
        .send({ currentPassword: 'not-my-password', newPassword: 'brand-new-password-42' })
        .expect(400);
      expect((wrong.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');

      await http()
        .post('/api/v1/auth/password/change')
        .set(bearer(current.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password-42' })
        .expect(204);

      await http().get('/api/v1/me').set(bearer(current.accessToken)).expect(200);
      await http().get('/api/v1/me').set(bearer(other.accessToken)).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(401);
      await login(t, admin.email, 'brand-new-password-42');
    });

    it('enforces the password policy', async () => {
      const { accessToken } = await login(t, admin.email);
      await http()
        .post('/api/v1/auth/password/change')
        .set(bearer(accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);
      await http()
        .post('/api/v1/auth/password/change')
        .set(bearer(accessToken))
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
        .expect(400);
    });

    it('blocks other routes until a required password change is done', async () => {
      await createUser(t.prisma, org, {
        email: 'must@a.test',
        roles: ['SUPER_ADMIN'],
        mustChangePassword: true,
      });
      const { accessToken } = await login(t, 'must@a.test');
      await http().get('/api/v1/me').set(bearer(accessToken)).expect(200);
      const blocked = await http().get('/api/v1/users').set(bearer(accessToken)).expect(403);
      expect((blocked.body as ErrorBody).error.code).toBe('PASSWORD_CHANGE_REQUIRED');
      await http()
        .post('/api/v1/auth/password/change')
        .set(bearer(accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'another-good-password' })
        .expect(204);
      await http().get('/api/v1/users').set(bearer(accessToken)).expect(200);
    });
  });

  describe('password set-up links', () => {
    it('lets a new user set a password once, then sign in', async () => {
      const { accessToken } = await login(t, admin.email);
      const created = await http()
        .post('/api/v1/users')
        .set(bearer(accessToken))
        .send({
          email: 'new@a.test',
          fullName: 'New User',
          roleIds: [org.roles['RECEPTION']],
          branchIds: [org.branches['A1']],
        })
        .expect(201);
      const { token } = (created.body as { passwordSetup: { token: string } }).passwordSetup;
      expect(created.headers['cache-control']).toBe('no-store');

      // Token is stored only as a hash.
      const stored = await t.prisma.passwordSetupToken.findFirstOrThrow();
      expect(stored.tokenHash).not.toBe(token);

      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'new@a.test', password: 'whatever-password' })
        .expect(401);
      await http()
        .post('/api/v1/auth/password-setup/complete')
        .send({ token, newPassword: 'my-first-password' })
        .expect(204);
      await login(t, 'new@a.test', 'my-first-password');

      const reused = await http()
        .post('/api/v1/auth/password-setup/complete')
        .send({ token, newPassword: 'attacker-password' })
        .expect(400);
      expect((reused.body as ErrorBody).error.code).toBe('INVALID_TOKEN');
    });

    it('rejects expired and superseded tokens, and unlocks on reset', async () => {
      const target = await createUser(t.prisma, org, {
        email: 'staff@a.test',
        roles: ['RECEPTION'],
        branches: ['A1'],
      });
      await t.prisma.user.update({
        where: { id: target.id },
        data: { lockedUntil: new Date(Date.now() + 600_000) },
      });
      const { accessToken } = await login(t, admin.email);

      const first = await http()
        .post(`/api/v1/users/${target.id}/password-setup`)
        .set(bearer(accessToken))
        .expect(201);
      const second = await http()
        .post(`/api/v1/users/${target.id}/password-setup`)
        .set(bearer(accessToken))
        .expect(201);
      const firstToken = (first.body as { token: string }).token;
      const secondToken = (second.body as { token: string }).token;

      await http()
        .post('/api/v1/auth/password-setup/complete')
        .send({ token: firstToken, newPassword: 'reset-password-one' })
        .expect(400);

      await t.prisma.passwordSetupToken.updateMany({
        where: { revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http()
        .post('/api/v1/auth/password-setup/complete')
        .send({ token: secondToken, newPassword: 'reset-password-two' })
        .expect(400);

      const third = await http()
        .post(`/api/v1/users/${target.id}/password-setup`)
        .set(bearer(accessToken))
        .expect(201);
      await http()
        .post('/api/v1/auth/password-setup/complete')
        .send({
          token: (third.body as { token: string }).token,
          newPassword: 'reset-password-three',
        })
        .expect(204);
      await login(t, 'staff@a.test', 'reset-password-three');
    });
  });

  describe('audit hygiene', () => {
    it('never writes passwords or tokens to the audit log', async () => {
      const { accessToken, cookie } = await login(t, admin.email);
      const created = await http()
        .post('/api/v1/users')
        .set(bearer(accessToken))
        .send({ email: 'x@a.test', fullName: 'X' })
        .expect(201);
      const setupToken = (created.body as { passwordSetup: { token: string } }).passwordSetup.token;
      await http().post('/api/v1/auth/refresh').set(CSRF).set('Cookie', cookie).expect(200);

      const rows = await t.prisma.auditLog.findMany();
      const dump = JSON.stringify(rows);
      expect(rows.length).toBeGreaterThan(1);
      for (const secret of [PASSWORD, setupToken, cookie.split('=')[1] ?? '', accessToken]) {
        expect(secret.length).toBeGreaterThan(5);
        expect(dump).not.toContain(secret);
      }
    });

    it('rejects modification of audit rows at the database level', async () => {
      await login(t, admin.email);
      await expect(t.prisma.auditLog.deleteMany()).rejects.toThrow(/append-only/);
      await expect(t.prisma.auditLog.updateMany({ data: { action: 'tampered' } })).rejects.toThrow(
        /append-only/,
      );
    });
  });
});

describe('Login rate limiting', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    await resetDatabase(t.prisma);
  });

  afterAll(async () => {
    await t.close();
  });

  it('returns 429 with the standard envelope once the per-IP limit is hit', async () => {
    for (let i = 0; i < 3; i += 1) {
      await request(t.server())
        .post('/api/v1/auth/login')
        .send({ email: 'x@a.test', password: 'x' })
        .expect(401);
    }
    const limited = await request(t.server())
      .post('/api/v1/auth/login')
      .send({ email: 'x@a.test', password: 'x' })
      .expect(429);
    expect((limited.body as ErrorBody).error.code).toBe('RATE_LIMITED');
  });
});
