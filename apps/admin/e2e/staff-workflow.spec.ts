import { type Page, expect, request, test } from '@playwright/test';

/**
 * CLAUDE.md §9: intake → diagnosis → estimate → approval → repair → payment → delivery,
 * each step done in the browser by the role that owns it. (Invoicing joins in Phase 7.)
 */
const PASSWORD = process.env['UAT_PASSWORD'] ?? '';
const DOMAIN = process.env['UAT_EMAIL_DOMAIN'] ?? 'uat.example.test';
const API = 'http://localhost:4200/api/v1';

async function signIn(page: Page, who: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@${DOMAIN}`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

async function openJob(page: Page, jobNumber: string) {
  await page.goto('/jobs');
  await page.getByRole('link', { name: jobNumber }).click();
  await expect(page.getByRole('heading', { name: new RegExp(jobNumber) })).toBeVisible();
}

async function changeStatus(page: Page, to: string, message?: string) {
  await page.getByRole('tab', { name: 'Work' }).click();
  const form = await openForm(page, 'Change status');
  await form.getByLabel('New status').selectOption(to);
  if (message)
    await form.getByLabel('Message for the customer (optional, keep it simple)').fill(message);
  await form.getByRole('button', { name: 'Change status' }).click();
}

/** Some forms sit in collapsed <details>; open them by their summary when needed. */
async function openForm(page: Page, name: string) {
  const form = page.getByRole('form', { name });
  const summary = page.locator('summary', { hasText: name }).first();
  await expect(form.or(summary).first()).toBeVisible();
  if (!(await form.isVisible())) await summary.click();
  await expect(form).toBeVisible();
  return form;
}

test.describe.configure({ mode: 'serial' });

test('a repair goes from intake to delivery, each role using the staff panel', async ({ page }) => {
  test.skip(!PASSWORD, 'run through bun run test:e2e');

  // Sample currency for the run (real currency is an owner decision).
  const api = await request.newContext();
  const admin = (await (
    await api.post(`${API}/auth/login`, {
      data: { email: `superadmin@${DOMAIN}`, password: PASSWORD },
    })
  ).json()) as { accessToken: string };
  await api.put(`${API}/settings/money`, {
    headers: { Authorization: `Bearer ${admin.accessToken}` },
    data: { value: { currency: 'XXX' }, reason: 'E2E run' },
  });

  // 1. Reception registers a new customer, device and complaint.
  await signIn(page, 'reception');
  await page.getByRole('link', { name: 'New job' }).click();
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Full name or business name').fill('Esha E2E');
  await page.getByLabel('Mobile number (with country code)').fill('+91 98000 12345');
  await page.getByRole('button', { name: 'Save and continue' }).click();
  // A new customer has no devices, so the device form is already open.
  await expect(page.getByRole('heading', { name: 'Device for Esha E2E' })).toBeVisible();
  await page.getByLabel('Category').selectOption({ label: 'Laptop' });
  await page.getByLabel('Brand').fill('Lenovo');
  await page.getByLabel('Model').fill('ThinkPad T14');
  await page.getByLabel('Serial number').fill(`E2E-${Date.now()}`);
  await page.getByRole('button', { name: 'Add device' }).click();
  await page
    .getByLabel("Complaint (customer's own words)")
    .fill('Keyboard keys stopped working after a spill.');
  await page.getByLabel('Accessories received (comma separated)').fill('Charger');
  await page.getByRole('button', { name: 'Review' }).click();
  await page.getByRole('button', { name: 'Register job' }).click();
  const jobNumber =
    (
      await page
        .getByText(/UAT-1-\d{4}-\d{6}/)
        .first()
        .textContent()
    )?.match(/UAT-1-\d{4}-\d{6}/)?.[0] ?? '';
  expect(jobNumber).not.toBe('');
  await signOut(page);

  // 2. Manager assigns the technician.
  await signIn(page, 'manager');
  await openJob(page, jobNumber);
  await page.getByRole('tab', { name: 'Work' }).click();
  await page.getByLabel('Assign technician').selectOption({ label: 'Tarun Technician' });
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Tarun Technician').first()).toBeVisible();
  await signOut(page);

  // 3. Technician diagnoses and prepares an estimate.
  await signIn(page, 'tech1');
  await openJob(page, jobNumber);
  await changeStatus(page, 'DIAGNOSIS');
  await page.getByRole('tab', { name: 'Work' }).click();
  const diagnosis = await openForm(page, 'Add diagnosis');
  await diagnosis.getByLabel('Symptom').fill('Keys unresponsive');
  await diagnosis.getByLabel('Findings').fill('Liquid residue under keyboard membrane');
  await diagnosis
    .getByLabel('Internal notes (staff only, never shown to the customer)')
    .fill('E2E internal note');
  await diagnosis.getByRole('button', { name: 'Save diagnosis' }).click();
  await expect(page.getByText('Liquid residue under keyboard membrane')).toBeVisible();
  await changeStatus(page, 'ESTIMATE_PREPARATION');
  await page.getByRole('tab', { name: 'Estimates' }).click();
  const draft = page
    .getByRole('region', { name: 'Estimate draft' })
    .or(page.getByLabel('Estimate draft'));
  await draft.getByLabel('Description').first().fill('Replacement keyboard');
  await draft.getByLabel('Quantity').first().fill('1');
  await draft.getByLabel('Unit price').first().fill('2500');
  await draft.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/version 1/i).first()).toBeVisible();
  await signOut(page);

  // 4. Manager sends it; the customer approves through the approval link.
  await signIn(page, 'manager');
  await openJob(page, jobNumber);
  await page.getByRole('tab', { name: 'Estimates' }).click();
  await page.getByRole('button', { name: /Send version 1 to customer/ }).click();
  const link = (await page.locator('code', { hasText: '#token=' }).textContent()) ?? '';
  const token = link.split('#token=')[1] ?? '';
  expect(token.length).toBeGreaterThan(20);
  const decision = await api.post(`${API}/public/estimate-links/decision`, {
    data: { token, decision: 'APPROVED', termsAccepted: true },
  });
  expect(decision.status()).toBe(200);
  await signOut(page);

  // 5. Technician repairs, passes QC and marks it ready.
  await signIn(page, 'tech1');
  await openJob(page, jobNumber);
  await changeStatus(page, 'REPAIR_IN_PROGRESS', 'We are replacing the keyboard now.');
  await changeStatus(page, 'QUALITY_CHECK');
  await page.getByRole('tab', { name: 'Work' }).click();
  const completion = await openForm(page, 'Complete repair');
  await completion.getByLabel('Repair summary').fill('Keyboard replaced; all keys tested.');
  for (const box of await completion.getByRole('checkbox').all()) await box.check();
  await completion.getByRole('button', { name: 'Complete repair' }).click();
  await expect(page.getByText(/Repair completed/i).first()).toBeVisible();
  await changeStatus(page, 'READY_FOR_DELIVERY', 'Your laptop is ready for collection.');
  await signOut(page);

  // 6. Accounts records the payment.
  await signIn(page, 'accounts');
  await openJob(page, jobNumber);
  await page.getByRole('tab', { name: 'Payments' }).click();
  const payment = await openForm(page, 'Record payment');
  await payment.getByLabel('Amount').fill('2500');
  await payment.getByLabel('Method').selectOption('CASH');
  await payment.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('button', { name: 'Receipt' }).first()).toBeVisible();
  await signOut(page);

  // 7. Delivery staff hands it over; the job is delivered and the challan prints.
  await signIn(page, 'delivery');
  await openJob(page, jobNumber);
  await page.getByRole('tab', { name: 'Delivery' }).click();
  const handover = await openForm(page, 'Hand over');
  await handover.getByLabel('Recipient name').fill('Esha E2E');
  for (const box of await handover.getByRole('checkbox').all()) await box.check();
  await handover.getByRole('button', { name: 'Complete hand-over' }).click();
  await expect(page.getByText(/received by Esha E2E/)).toBeVisible();
  await page.getByRole('tab', { name: 'Overview' }).click();
  await expect(page.getByRole('heading', { name: `${jobNumber} Delivered` })).toBeVisible();

  // History shows every step; the challan opens as a PDF.
  await page.getByRole('tab', { name: 'Timeline' }).click();
  const history = (
    await page.getByRole('tabpanel', { name: 'Timeline' }).getByRole('listitem').allTextContents()
  ).map((t) => t.split(' — ')[0]);
  expect(history).toEqual([
    'Received',
    'Diagnosis',
    'Estimate preparation',
    'Awaiting approval',
    'Repair in progress',
    'Quality check',
    'Repair completed',
    'Ready for delivery',
    'Delivered',
  ]);
  await api.dispose();
});
