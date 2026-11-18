import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MockOtpProvider } from '../src/customer-auth/otp-provider.js';
import {
  PNG_BYTES,
  type OrgFixture,
  type TestApp,
  bearer,
  createOrg,
  createTestApp,
  createUser,
  login,
  newKey,
  resetDatabase,
} from './integration/harness.js';

interface ErrorBody {
  error: { code: string };
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface CustomerJobBody {
  id: string;
  jobNumber: string;
  status: string;
  statusLabel: string;
  timeline: { status: string }[];
}

const PHONE = '+91 98123 45678';

/** Customer sign-in (mock OTP), own-data access, complaint submission. */
describe('Customer portal (real PostgreSQL + S3)', () => {
  let t: TestApp;
  let otp: MockOtpProvider;
  let org: OrgFixture;

  beforeAll(async () => {
    t = await createTestApp({ OTP_RESEND_INTERVAL_SECONDS: '10' });
    otp = t.app.get(MockOtpProvider);
  });

  afterAll(async () => {
    await t.close();
  });

  beforeEach(async () => {
    await resetDatabase(t.prisma);
    otp.sent.clear();
    org = await createOrg(t.prisma, 'ORGA', ['A1']);
    await createOrg(t.prisma, 'ORGB', ['B1']);
  });

  const http = () => request(t.server());

  async function requestCode(phone = PHONE): Promise<string> {
    await http()
      .post('/api/v1/customer/auth/otp/request')
      .send({ organizationCode: 'orga', phone })
      .expect(200);
    const normalized = `+${phone.replace(/\D/g, '')}`;
    const code = otp.sent.get(normalized);
    if (!code) throw new Error('no code sent');
    return code;
  }

  async function signIn(phone = PHONE, fullName = 'Asha Rao'): Promise<Tokens> {
    const code = await requestCode(phone);
    const response = await http()
      .post('/api/v1/customer/auth/otp/verify')
      .send({ organizationCode: 'ORGA', phone, code, fullName })
      .expect(200);
    return response.body as Tokens;
  }

  function complaint(overrides: Record<string, unknown> = {}) {
    return {
      branchId: org.branches['A1'],
      newAsset: {
        categoryId: org.categories['PRINTER'],
        brand: 'Inkly',
        model: 'P200',
        serialNumber: 'PR-9',
      },
      warrantyClaim: 'IN_WARRANTY',
      serviceMode: 'AT_SERVICE_CENTRE',
      complaint: 'Paper jams on every page',
      accessories: ['Power cable'],
      ...overrides,
    };
  }

  describe('sign-in', () => {
    it('answers identically for unknown organizations and never reveals codes', async () => {
      const known = await http()
        .post('/api/v1/customer/auth/otp/request')
        .send({ organizationCode: 'ORGA', phone: PHONE })
        .expect(200);
      const unknown = await http()
        .post('/api/v1/customer/auth/otp/request')
        .send({ organizationCode: 'NOPE', phone: PHONE })
        .expect(200);
      expect(unknown.body).toEqual(known.body);
      expect(JSON.stringify(known.body)).not.toMatch(/\d{6}/);
      const stored = await t.prisma.customerOtpChallenge.findFirstOrThrow();
      expect(stored.codeHash).not.toBe(otp.sent.get('+919812345678'));
    });

    it('asks new customers for a name, then creates their customer record', async () => {
      const code = await requestCode();
      const noName = await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code })
        .expect(400);
      expect((noName.body as ErrorBody).error.code).toBe('PROFILE_REQUIRED');
      const ok = await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code, fullName: 'Asha Rao' })
        .expect(200);
      const tokens = ok.body as Tokens;
      const me = await http()
        .get('/api/v1/customer/me')
        .set(bearer(tokens.accessToken))
        .expect(200);
      expect(me.body).toMatchObject({
        name: 'Asha Rao',
        phone: '+91 98123 45678',
        organization: { code: 'ORGA' },
      });
      const customer = await t.prisma.customer.findFirstOrThrow();
      expect(customer.source).toBe('CUSTOMER_APP');
    });

    it('signs existing customers into their staff-created record', async () => {
      const reception = await createUser(t.prisma, org, {
        email: 'r@a.test',
        roles: ['RECEPTION'],
        branches: ['A1'],
      });
      const staffToken = (await login(t, reception.email)).accessToken;
      const created = await http()
        .post('/api/v1/customers')
        .set(bearer(staffToken))
        .send({ type: 'INDIVIDUAL', name: 'Walk-in Customer', phone: PHONE })
        .expect(201);
      const tokens = await signIn(PHONE, 'ignored');
      const me = await http()
        .get('/api/v1/customer/me')
        .set(bearer(tokens.accessToken))
        .expect(200);
      expect((me.body as { id: string }).id).toBe((created.body as { id: string }).id);
    });

    it('refuses ambiguous numbers shared by several customers', async () => {
      const reception = await createUser(t.prisma, org, {
        email: 'r@a.test',
        roles: ['RECEPTION'],
        branches: ['A1'],
      });
      const staffToken = (await login(t, reception.email)).accessToken;
      for (const name of ['Person', 'Business Ltd']) {
        await http()
          .post('/api/v1/customers')
          .set(bearer(staffToken))
          .send({ type: 'INDIVIDUAL', name, phone: PHONE })
          .expect(201);
      }
      const code = await requestCode();
      const response = await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code })
        .expect(409);
      expect((response.body as ErrorBody).error.code).toBe('ACCOUNT_AMBIGUOUS');
    });

    it('limits wrong-code attempts and makes codes single-use', async () => {
      const code = await requestCode();
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < t.env.OTP_MAX_ATTEMPTS; i += 1) {
        await http()
          .post('/api/v1/customer/auth/otp/verify')
          .send({ organizationCode: 'ORGA', phone: PHONE, code: wrong, fullName: 'A' })
          .expect(401);
      }
      // Correct code no longer works after too many attempts.
      await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code, fullName: 'A' })
        .expect(401);

      await t.prisma.customerOtpChallenge.deleteMany();
      const fresh = await requestCode();
      await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code: fresh, fullName: 'A' })
        .expect(200);
      await http()
        .post('/api/v1/customer/auth/otp/verify')
        .send({ organizationCode: 'ORGA', phone: PHONE, code: fresh, fullName: 'A' })
        .expect(401);
    });

    it('throttles resends to one per interval', async () => {
      await requestCode();
      otp.sent.clear();
      await http()
        .post('/api/v1/customer/auth/otp/request')
        .send({ organizationCode: 'ORGA', phone: PHONE })
        .expect(200);
      expect(otp.sent.size).toBe(0);
    });

    it('rotates refresh tokens and revokes the session on reuse', async () => {
      const tokens = await signIn();
      const rotated = await http()
        .post('/api/v1/customer/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);
      const next = rotated.body as Tokens;
      await http()
        .post('/api/v1/customer/auth/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/customer/auth/refresh')
        .send({ refreshToken: next.refreshToken })
        .expect(401);
      await http().get('/api/v1/customer/me').set(bearer(next.accessToken)).expect(401);
    });
  });

  describe('token separation', () => {
    it('never accepts customer tokens on staff routes or staff tokens on customer routes', async () => {
      const customer = await signIn();
      await http().get('/api/v1/me').set(bearer(customer.accessToken)).expect(401);
      await http().get('/api/v1/jobs').set(bearer(customer.accessToken)).expect(401);

      const staff = await createUser(t.prisma, org, {
        email: 'admin@a.test',
        roles: ['SUPER_ADMIN'],
      });
      const staffLogin = await login(t, staff.email);
      await http().get('/api/v1/customer/me').set(bearer(staffLogin.accessToken)).expect(401);

      // Refresh tokens are not interchangeable either.
      const staffRefresh = staffLogin.cookie.split('=')[1] ?? '';
      await http()
        .post('/api/v1/customer/auth/refresh')
        .send({ refreshToken: staffRefresh })
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .set({ 'X-ICON-CSRF': '1', Cookie: `icon_rt=${customer.refreshToken}` })
        .expect(401);
      // …and the rejected attempts did not burn the legitimate tokens.
      await http()
        .post('/api/v1/customer/auth/refresh')
        .send({ refreshToken: customer.refreshToken })
        .expect(200);
    });
  });

  describe('complaints and own data', () => {
    it('submits a complaint with a new device and photos, idempotently', async () => {
      const tokens = await signIn();
      const photo = await http()
        .post('/api/v1/customer/files')
        .set(bearer(tokens.accessToken))
        .attach('file', PNG_BYTES, { filename: 'jam.png' })
        .expect(201);
      const key = newKey();
      const body = complaint({ photoFileIds: [(photo.body as { id: string }).id] });
      const first = await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(tokens.accessToken))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      const job = first.body as CustomerJobBody;
      expect(job).toMatchObject({ status: 'REQUEST_RECEIVED', statusLabel: 'Request received' });
      expect(job.timeline).toEqual([expect.objectContaining({ status: 'REQUEST_RECEIVED' })]);
      // Customer-safe response: no internal status names or staff-only fields.
      expect(Object.keys(job).sort()).toEqual(
        [
          'branch',
          'complaint',
          'device',
          'id',
          'jobNumber',
          'serviceMode',
          'status',
          'statusLabel',
          'submittedAt',
          'timeline',
        ].sort(),
      );

      const replay = await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(tokens.accessToken))
        .set('Idempotency-Key', key)
        .send(body)
        .expect(201);
      expect((replay.body as CustomerJobBody).id).toBe(job.id);
      expect(await t.prisma.serviceJob.count()).toBe(1);

      const stored = await t.prisma.serviceJob.findUniqueOrThrow({
        where: { id: job.id },
        include: { attachments: true },
      });
      expect(stored).toMatchObject({
        status: 'AWAITING_DEVICE',
        channel: 'CUSTOMER_APP',
        serviceType: 'WARRANTY_UNVERIFIED',
        receivedAt: null,
      });
      expect(stored.attachments).toEqual([
        expect.objectContaining({ category: 'CUSTOMER_PHOTO', visibility: 'CUSTOMER' }),
      ]);

      const list = await http()
        .get('/api/v1/customer/jobs')
        .set(bearer(tokens.accessToken))
        .expect(200);
      expect((list.body as CustomerJobBody[]).map((j) => j.id)).toEqual([job.id]);
      const assets = await http()
        .get('/api/v1/customer/assets')
        .set(bearer(tokens.accessToken))
        .expect(200);
      expect((assets.body as { brand: string }[]).map((a) => a.brand)).toEqual(['Inkly']);
    });

    it('isolates customers from each other', async () => {
      const asha = await signIn(PHONE, 'Asha');
      const ravi = await signIn('+91 98000 11111', 'Ravi');
      const created = await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(asha.accessToken))
        .set('Idempotency-Key', newKey())
        .send(complaint())
        .expect(201);
      const jobId = (created.body as CustomerJobBody).id;
      await http().get(`/api/v1/customer/jobs/${jobId}`).set(bearer(ravi.accessToken)).expect(404);
      await http()
        .post(`/api/v1/customer/jobs/${jobId}/receipt`)
        .set(bearer(ravi.accessToken))
        .expect(404);
      const raviJobs = await http()
        .get('/api/v1/customer/jobs')
        .set(bearer(ravi.accessToken))
        .expect(200);
      expect(raviJobs.body).toEqual([]);

      // Ravi cannot file a complaint against Asha's device or attach Asha's photo.
      const ashaAsset = await t.prisma.asset.findFirstOrThrow();
      await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(ravi.accessToken))
        .set('Idempotency-Key', newKey())
        .send(complaint({ newAsset: undefined, assetId: ashaAsset.id }))
        .expect(404);
      const photo = await http()
        .post('/api/v1/customer/files')
        .set(bearer(asha.accessToken))
        .attach('file', PNG_BYTES, { filename: 'a.png' })
        .expect(201);
      await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(ravi.accessToken))
        .set('Idempotency-Key', newKey())
        .send(complaint({ photoFileIds: [(photo.body as { id: string }).id] }))
        .expect(404);
    });

    it('lets customers download their own receipt', async () => {
      const tokens = await signIn();
      const created = await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(tokens.accessToken))
        .set('Idempotency-Key', newKey())
        .send(complaint())
        .expect(201);
      const receipt = await http()
        .post(`/api/v1/customer/jobs/${(created.body as CustomerJobBody).id}/receipt`)
        .set(bearer(tokens.accessToken))
        .expect(201);
      const pdf = Buffer.from(
        await (await fetch((receipt.body as { url: string }).url)).arrayBuffer(),
      );
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    }, 60_000);

    it('lets staff see customer-submitted jobs, which start before the device arrives', async () => {
      const tokens = await signIn();
      await http()
        .post('/api/v1/customer/jobs')
        .set(bearer(tokens.accessToken))
        .set('Idempotency-Key', newKey())
        .send(complaint())
        .expect(201);
      const reception = await createUser(t.prisma, org, {
        email: 'r@a.test',
        roles: ['RECEPTION'],
        branches: ['A1'],
      });
      const staffToken = (await login(t, reception.email)).accessToken;
      const jobs = await http()
        .get('/api/v1/jobs?status=AWAITING_DEVICE')
        .set(bearer(staffToken))
        .expect(200);
      expect((jobs.body as { total: number }).total).toBe(1);
    });
  });
});
