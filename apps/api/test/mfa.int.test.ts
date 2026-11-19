import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { base32Decode, hotp, timeStep } from '../src/mfa/totp.js';
import {
  PASSWORD,
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

describe('Two-step sign-in (TOTP MFA, enforced)', () => {
  let t: TestApp;
  let org: OrgFixture;

  beforeAll(async () => {
    t = await createTestApp({ MFA_ENFORCEMENT: 'required' });
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    org = await createOrg(t.prisma, 'ORGA', ['A1']);
    await createUser(t.prisma, org, { email: 'boss@a.test', roles: ['SUPER_ADMIN'] });
    await createUser(t.prisma, org, { email: 'boss2@a.test', roles: ['SUPER_ADMIN'] });
    await createUser(t.prisma, org, {
      email: 'manager@a.test',
      roles: ['BRANCH_ADMIN'],
      branches: ['A1'],
    });
    await createUser(t.prisma, org, {
      email: 'desk@a.test',
      roles: ['RECEPTION'],
      branches: ['A1'],
    });
  });

  const http = () => request(t.server());
  const code = (secret: string, offset = 0n) =>
    hotp(base32Decode(secret), timeStep(new Date()) + offset);

  /** Enrols the user and returns the base32 secret and recovery codes. */
  async function enrol(email: string): Promise<{ secret: string; recoveryCodes: string[] }> {
    const { accessToken } = await login(t, email);
    const start = await http()
      .post('/api/v1/auth/mfa/enrollment')
      .set(bearer(accessToken))
      .expect(201);
    const { secret, otpauthUri } = start.body as { secret: string; otpauthUri: string };
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\/ICON%20Service%3A.*\?secret=/);
    const confirmed = await http()
      .post('/api/v1/auth/mfa/enrollment/confirm')
      .set(bearer(accessToken))
      .send({ code: code(secret) })
      .expect(200);
    return { secret, recoveryCodes: (confirmed.body as { recoveryCodes: string[] }).recoveryCodes };
  }

  async function challenge(email: string): Promise<string> {
    const res = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    const body = res.body as {
      mfaRequired?: boolean;
      challengeToken?: string;
      accessToken?: string;
    };
    expect(body).toMatchObject({ mfaRequired: true });
    expect(body.accessToken).toBeUndefined();
    expect(res.headers['set-cookie']).toBeUndefined();
    return body.challengeToken ?? '';
  }

  it('keeps privileged staff to MFA set-up until enrolled; others are unaffected', async () => {
    const boss = await login(t, 'boss@a.test');
    const loginBody = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'boss@a.test', password: PASSWORD })
        .expect(200)
    ).body as { mfaEnrollmentRequired: boolean };
    expect(loginBody.mfaEnrollmentRequired).toBe(true);
    const blocked = await http().get('/api/v1/jobs').set(bearer(boss.accessToken)).expect(403);
    expect((blocked.body as ErrorBody).error.code).toBe('MFA_ENROLLMENT_REQUIRED');
    expect(
      (await http().get('/api/v1/me').set(bearer(boss.accessToken)).expect(200)).body,
    ).toMatchObject({ mfaEnrollmentRequired: true, mfaEnabled: false });
    expect(
      (await http().get('/api/v1/auth/mfa').set(bearer(boss.accessToken)).expect(200)).body,
    ).toEqual({ enabled: false, required: true, recoveryCodesRemaining: 0 });

    const desk = await login(t, 'desk@a.test');
    await http().get('/api/v1/jobs').set(bearer(desk.accessToken)).expect(200);

    // Wrong first code is refused; the right one enables MFA and unlocks the same session.
    const start = await http()
      .post('/api/v1/auth/mfa/enrollment')
      .set(bearer(boss.accessToken))
      .expect(201);
    const { secret } = start.body as { secret: string };
    const wrong = await http()
      .post('/api/v1/auth/mfa/enrollment/confirm')
      .set(bearer(boss.accessToken))
      .send({ code: code(secret) === '000000' ? '111111' : '000000' })
      .expect(400);
    expect((wrong.body as ErrorBody).error.code).toBe('MFA_INVALID');
    const confirmed = await http()
      .post('/api/v1/auth/mfa/enrollment/confirm')
      .set(bearer(boss.accessToken))
      .send({ code: code(secret) })
      .expect(200);
    expect((confirmed.body as { recoveryCodes: string[] }).recoveryCodes).toHaveLength(10);
    await http().get('/api/v1/jobs').set(bearer(boss.accessToken)).expect(200);
    await http().post('/api/v1/auth/mfa/enrollment').set(bearer(boss.accessToken)).expect(409);

    // The secret is sealed at rest.
    const row = await t.prisma.userMfa.findFirstOrThrow();
    expect(row.secretSealed).not.toContain(secret);
    expect(row.secretSealed.startsWith('v1.')).toBe(true);
    expect(await t.prisma.auditLog.count({ where: { action: 'mfa.enabled' } })).toBe(1);
  });

  it('requires the code at sign-in and never accepts the same code twice', async () => {
    const { secret } = await enrol('boss@a.test');
    // The enrolment code's time step is spent: the next step's code is needed.
    const first = await challenge('boss@a.test');
    const replay = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: first, code: code(secret) })
      .expect(401);
    expect((replay.body as ErrorBody).error.code).toBe('MFA_INVALID');
    const next = code(secret, 1n);
    const ok = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: first, code: next })
      .expect(200);
    expect(ok.body).toMatchObject({ tokenType: 'Bearer', mfaEnrollmentRequired: false });
    expect(String(ok.headers['set-cookie'])).toMatch(/HttpOnly/);
    // Challenge is single-use, and the step cannot be reused with a fresh challenge.
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: first, code: next })
      .expect(401);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: await challenge('boss@a.test'), code: next })
      .expect(401);
    expect(
      await t.prisma.auditLog.count({
        where: { action: 'auth.login.succeeded', after: { equals: { mfa: 'TOTP' } } },
      }),
    ).toBe(1);
  });

  it('accepts each recovery code once', async () => {
    const { recoveryCodes } = await enrol('boss@a.test');
    const recovery = recoveryCodes[0] ?? '';
    expect(recovery).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: await challenge('boss@a.test'), code: recovery.toUpperCase() })
      .expect(200);
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: await challenge('boss@a.test'), code: recovery })
      .expect(401);
    const { accessToken } = (
      await http()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: await challenge('boss@a.test'), code: recoveryCodes[1] })
        .expect(200)
    ).body as { accessToken: string };
    expect(
      (await http().get('/api/v1/auth/mfa').set(bearer(accessToken)).expect(200)).body,
    ).toMatchObject({ enabled: true, recoveryCodesRemaining: 8 });
  });

  it('limits attempts per challenge, counts failures toward lockout and expires challenges', async () => {
    const { secret } = await enrol('boss@a.test');
    const token = await challenge('boss@a.test');
    for (let i = 0; i < 4; i += 1)
      await http()
        .post('/api/v1/auth/mfa/verify')
        .send({ challengeToken: token, code: '000000' })
        .expect(401);
    // 5th failure locks the account (LOGIN_MAX_FAILED_ATTEMPTS = 5) and the challenge is spent.
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: token, code: '000000' })
      .expect(401);
    expect(
      (await t.prisma.user.findFirstOrThrow({ where: { email: 'boss@a.test' } })).lockedUntil,
    ).not.toBeNull();
    const dead = await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: token, code: code(secret, 1n) })
      .expect(401);
    expect((dead.body as ErrorBody).error.code).toBe('INVALID_TOKEN');
    await http()
      .post('/api/v1/auth/login')
      .send({ email: 'boss@a.test', password: PASSWORD })
      .expect(401);

    await t.prisma.user.updateMany({ data: { lockedUntil: null, failedLoginCount: 0 } });
    const late = await challenge('boss@a.test');
    await t.prisma.mfaChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await http()
      .post('/api/v1/auth/mfa/verify')
      .send({ challengeToken: late, code: code(secret, 1n) })
      .expect(401);
  });

  it('lets another administrator reset MFA with a reason, signing the user out', async () => {
    await enrol('boss@a.test');
    const boss2 = await enrol('boss2@a.test');
    const bossId = (await t.prisma.user.findFirstOrThrow({ where: { email: 'boss@a.test' } })).id;
    const boss2Token = (
      (
        await http()
          .post('/api/v1/auth/mfa/verify')
          .send({ challengeToken: await challenge('boss2@a.test'), code: boss2.recoveryCodes[0] })
          .expect(200)
      ).body as { accessToken: string }
    ).accessToken;
    const boss2Id = (await t.prisma.user.findFirstOrThrow({ where: { email: 'boss2@a.test' } })).id;

    await http()
      .post(`/api/v1/users/${boss2Id}/mfa/reset`)
      .set(bearer(boss2Token))
      .send({ reason: 'self' })
      .expect(403);
    await http()
      .post(`/api/v1/users/${bossId}/mfa/reset`)
      .set(bearer(boss2Token))
      .send({})
      .expect(400);
    await http()
      .post(`/api/v1/users/${bossId}/mfa/reset`)
      .set(bearer(boss2Token))
      .send({ reason: 'Lost phone, identity checked in person' })
      .expect(204);
    expect(await t.prisma.userMfa.count({ where: { userId: bossId } })).toBe(0);
    expect(await t.prisma.authSession.count({ where: { userId: bossId, revokedAt: null } })).toBe(
      0,
    );
    const audit = await t.prisma.auditLog.findFirstOrThrow({ where: { action: 'mfa.reset' } });
    expect(audit).toMatchObject({
      entityId: bossId,
      reason: 'Lost phone, identity checked in person',
    });
    // After reset the user signs in with the password and must enrol again.
    const again = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'boss@a.test', password: PASSWORD })
        .expect(200)
    ).body as { mfaEnrollmentRequired: boolean };
    expect(again.mfaEnrollmentRequired).toBe(true);

    // A branch admin cannot reset a super admin (holds fewer permissions).
    const manager = await enrol('manager@a.test');
    const managerToken = (
      (
        await http()
          .post('/api/v1/auth/mfa/verify')
          .send({
            challengeToken: await challenge('manager@a.test'),
            code: manager.recoveryCodes[0],
          })
          .expect(200)
      ).body as { accessToken: string }
    ).accessToken;
    await http()
      .post(`/api/v1/users/${boss2Id}/mfa/reset`)
      .set(bearer(managerToken))
      .send({ reason: 'x' })
      .expect(403);
  });
});
