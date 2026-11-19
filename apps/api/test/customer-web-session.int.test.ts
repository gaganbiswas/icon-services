import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockOtpProvider } from '../src/customer-auth/otp-provider.js';
import { type TestApp, bearer, createOrg, createTestApp, resetDatabase } from './integration/harness.js';

const PHONE = '+919812345678';
const ORIGIN = 'http://localhost:5173';

function cookieFrom(setCookie: string | string[] | undefined): { pair: string; header: string } {
  const header = (Array.isArray(setCookie) ? setCookie : [setCookie ?? '']).find((c) => c.startsWith('icon_crt=')) ?? '';
  return { pair: header.split(';')[0] ?? '', header };
}

describe('Customer web-portal sessions (HttpOnly cookie)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await resetDatabase(t.prisma);
    await createOrg(t.prisma, 'ORGA', ['A1']);
  });

  const http = () => request(t.server());

  async function signIn() {
    await http().post('/api/v1/customer/auth/otp/request').send({ organizationCode: 'ORGA', phone: PHONE }).expect(200);
    const code = t.app.get(MockOtpProvider).sent.get(PHONE) ?? '';
    return http().post('/api/v1/customer/auth/web/verify').send({ organizationCode: 'ORGA', phone: PHONE, code, fullName: 'Asha' }).expect(200);
  }

  it('keeps the refresh token out of reach of scripts and rotates it with CSRF protection', async () => {
    const res = await signIn();
    const body = res.body as Record<string, unknown>;
    expect(body['accessToken']).toEqual(expect.any(String));
    expect(body['refreshToken']).toBeUndefined();
    const cookie = cookieFrom(res.headers['set-cookie']);
    expect(cookie.header).toMatch(/HttpOnly/);
    expect(cookie.header).toMatch(/SameSite=Strict/);
    expect(cookie.header).toMatch(/Path=\/api\/v1\/customer\/auth\/web/);
    await http().get('/api/v1/customer/me').set(bearer(String(body['accessToken']))).expect(200);

    // No CSRF header → refused.
    await http().post('/api/v1/customer/auth/web/refresh').set('Cookie', cookie.pair).expect(403);
    await http().post('/api/v1/customer/auth/web/refresh').set('Cookie', cookie.pair).set('X-ICON-CSRF', '1').set('Origin', 'https://evil.example').expect(403);
    const refreshed = await http().post('/api/v1/customer/auth/web/refresh').set('Cookie', cookie.pair).set('X-ICON-CSRF', '1').set('Origin', ORIGIN).expect(200);
    const rotated = cookieFrom(refreshed.headers['set-cookie']);
    expect(rotated.pair).not.toBe(cookie.pair);
    // Re-using the old cookie is detected and rejected.
    await http().post('/api/v1/customer/auth/web/refresh').set('Cookie', cookie.pair).set('X-ICON-CSRF', '1').expect(401);

    await http().post('/api/v1/customer/auth/web/logout').set('Cookie', rotated.pair).set('X-ICON-CSRF', '1').expect(204);
    await http().post('/api/v1/customer/auth/web/refresh').set('Cookie', rotated.pair).set('X-ICON-CSRF', '1').expect(401);
  });
});
