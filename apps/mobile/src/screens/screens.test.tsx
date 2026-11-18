import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { SessionProvider } from '../session';
import { TOKENS, fakeApi, json } from '../test/fake-api';
import { JobDetailScreen } from './JobDetailScreen';
import { NewRequestScreen } from './NewRequestScreen';
import { SignInScreen } from './SignInScreen';

const BRANCH = { id: '01a1eeac-6f23-74c8-bac5-000000000004', name: 'Main Branch' };
const CATEGORY = { id: '01a1eeac-6f23-74c8-bac5-000000000003', code: 'PRINTER', name: 'Printer' };
const JOB = {
  id: 'job-1',
  jobNumber: 'A1-2026-000007',
  status: 'REQUEST_RECEIVED',
  statusLabel: 'Request received',
  serviceMode: 'AT_SERVICE_CENTRE',
  branch: { name: 'Main Branch' },
  device: { category: 'Printer', brand: 'Inkly', model: 'P200', serialNumber: null },
  complaint: 'Paper jams',
  submittedAt: '2026-11-18T10:00:00.000Z',
  updates: [{ message: 'Replacement part ordered', at: '2026-11-18T12:00:00.000Z' }],
  timeline: [
    {
      status: 'REQUEST_RECEIVED',
      label: 'Request received',
      message: null,
      at: '2026-11-18T10:00:00.000Z',
    },
  ],
};

describe('SignInScreen', () => {
  it('asks a new customer for a name after the code, then signs in', async () => {
    let verifyCalls = 0;
    const { api, calls } = fakeApi((path) => {
      if (path === '/customer/auth/otp/request')
        return json(200, { sent: true, expiresInSeconds: 300 });
      if (path === '/customer/auth/otp/verify') {
        verifyCalls += 1;
        return verifyCalls === 1
          ? json(400, { error: { code: 'PROFILE_REQUIRED', message: 'Enter your name' } })
          : json(200, TOKENS);
      }
      return json(401, {});
    });
    const onSignedIn = jest.fn();
    await render(
      <SessionProvider api={api}>
        <SignInScreen onSignedIn={onSignedIn} />
      </SessionProvider>,
    );
    await fireEvent.changeText(
      screen.getByLabelText('Mobile number (with country code)'),
      '+91 98123 45678',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    await fireEvent.changeText(await screen.findByLabelText('6-digit code'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    await fireEvent.changeText(await screen.findByLabelText('Your full name'), 'Asha Rao');
    await fireEvent.press(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
    const last = calls.filter((c) => c.path === '/customer/auth/otp/verify').at(-1);
    expect(JSON.parse(String(last?.init.body))).toMatchObject({
      organizationCode: 'DEV',
      code: '123456',
      fullName: 'Asha Rao',
    });
  });
});

describe('NewRequestScreen', () => {
  function setup(
    onSubmit: (
      headers: Record<string, string>,
      attempt: number,
    ) => { status: number; body?: unknown },
  ) {
    let attempts = 0;
    return fakeApi((path, init) => {
      if (path === '/customer/auth/refresh') return json(200, TOKENS);
      if (path === '/customer/branches') return json(200, [BRANCH]);
      if (path === '/customer/asset-categories') return json(200, [CATEGORY]);
      if (path === '/customer/assets') return json(200, []);
      if (path === '/customer/jobs' && init.method === 'POST') {
        attempts += 1;
        return onSubmit(init.headers as Record<string, string>, attempts);
      }
      return json(404, {});
    }, 'stored-refresh-token-000000');
  }

  async function fill() {
    await fireEvent.press(await screen.findByRole('radio', { name: 'Printer' }));
    await fireEvent.changeText(screen.getByLabelText('Brand'), 'Inkly');
    await fireEvent.changeText(screen.getByLabelText('Model'), 'P200');
    await fireEvent.changeText(
      screen.getByLabelText('Describe the problem'),
      'Paper jams on every page',
    );
  }

  it('validates before submitting', async () => {
    const { api, calls } = setup(() => json(201, JOB));
    await render(
      <SessionProvider api={api}>
        <NewRequestScreen onSubmitted={jest.fn()} />
      </SessionProvider>,
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Submit request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Describe the problem/);
    expect(calls.some((c) => c.path === '/customer/jobs')).toBe(false);
  });

  it('reuses the Idempotency-Key when retrying the same request after a failure', async () => {
    const keys: string[] = [];
    const { api, calls } = setup((headers, attempt) => {
      keys.push(headers['Idempotency-Key'] ?? '');
      return attempt === 1
        ? json(503, { error: { code: 'INTERNAL_ERROR', message: 'Try later' } })
        : json(201, JOB);
    });
    const onSubmitted = jest.fn();
    await render(
      <SessionProvider api={api}>
        <NewRequestScreen onSubmitted={onSubmitted} />
      </SessionProvider>,
    );
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit request' }));
    expect(await screen.findByText(/Try later/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledWith(JOB));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    const body = JSON.parse(
      String(calls.find((c) => c.path === '/customer/jobs')?.init.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      branchId: BRANCH.id,
      newAsset: { categoryId: CATEGORY.id, brand: 'Inkly', model: 'P200' },
      warrantyClaim: 'NOT_SURE',
      serviceMode: 'AT_SERVICE_CENTRE',
    });
  });

  it('uses a new key when the request changes after a failure', async () => {
    const keys: string[] = [];
    const { api } = setup((headers) => {
      keys.push(headers['Idempotency-Key'] ?? '');
      return json(503, { error: { code: 'INTERNAL_ERROR', message: 'Try later' } });
    });
    await render(
      <SessionProvider api={api}>
        <NewRequestScreen onSubmitted={jest.fn()} />
      </SessionProvider>,
    );
    await fill();
    await fireEvent.press(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText(/Try later/);
    await fireEvent.changeText(
      screen.getByLabelText('Describe the problem'),
      'Paper jams and grinding noise',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Submit request' }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe('JobDetailScreen', () => {
  it('shows customer-friendly progress and shares the receipt', async () => {
    const { api } = fakeApi(
      (path) => (path === '/customer/auth/refresh' ? json(200, TOKENS) : json(200, JOB)),
      'stored-refresh-token-000000',
    );
    const share = jest.fn(() => Promise.resolve());
    await render(
      <SessionProvider api={api}>
        <JobDetailScreen id="job-1" share={share} />
      </SessionProvider>,
    );
    expect(await screen.findByText('Status: Request received')).toBeOnTheScreen();
    expect(screen.queryByText(/AWAITING_DEVICE/)).toBeNull();
    expect(screen.getByText(/Replacement part ordered/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Download / share receipt' }));
    await waitFor(() => expect(share).toHaveBeenCalledWith(api, 'job-1'));
  });
});
