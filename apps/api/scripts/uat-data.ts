/**
 * UAT sample business data, created through the running API (Phase 11).
 * Every record passes the same validation, permissions, workflow rules and audit
 * as real use. Run after `bun run db:seed:uat` with the API running:
 *
 *   UAT_PASSWORD=… [UAT_API_URL=http://localhost:4000] bun run uat:data
 *
 * Sample people/devices are fictitious. Refuses to run twice (idempotent by check).
 */
import { HANDOVER_CHECKLIST, QC_CHECKLIST } from '@icon/contracts';

const API = `${(process.env['UAT_API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '')}/api/v1`;
const PASSWORD = process.env['UAT_PASSWORD'] ?? '';
const DOMAIN = process.env['UAT_EMAIL_DOMAIN'] ?? 'uat.example.test';
if (!PASSWORD) throw new Error('UAT_PASSWORD must be set (same value as for db:seed:uat)');

type Json = Record<string, unknown>;
const tokens = new Map<string, string>();

async function call<T = Json>(
  who: string | null,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  attempt = 1,
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(who ? { Authorization: `Bearer ${await token(who)}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  if (response.status === 429 && attempt <= 3) {
    // Sign-in and approval links are rate-limited per IP (security control): wait, then retry.
    const wait = Number(response.headers.get('retry-after') ?? '60');
    console.log(`Rate limited; waiting ${wait}s …`);
    await new Promise((resolve) => setTimeout(resolve, (wait + 1) * 1000));
    return call<T>(who, method, path, body, headers, attempt + 1);
  }
  if (!response.ok)
    throw new Error(
      `${method} ${path} as ${who ?? 'public'} → ${response.status}: ${text.slice(0, 300)}`,
    );
  return (text ? JSON.parse(text) : {}) as T;
}

async function token(who: string): Promise<string> {
  const cached = tokens.get(who);
  if (cached) return cached;
  const result = await call<{ accessToken?: string; mfaRequired?: boolean }>(
    null,
    'POST',
    '/auth/login',
    { email: `${who}@${DOMAIN}`, password: PASSWORD },
  );
  if (!result.accessToken)
    throw new Error(`${who} needs two-step sign-in; run UAT data with MFA_ENFORCEMENT=optional`);
  tokens.set(who, result.accessToken);
  return result.accessToken;
}

const key = () => crypto.randomUUID();
const version = async (id: string) =>
  (await call<{ version: number }>('superadmin', 'GET', `/jobs/${id}`)).version;
const move = async (id: string, who: string, to: string, extra: Json = {}) =>
  call(who, 'POST', `/jobs/${id}/status-transitions`, { to, version: await version(id), ...extra });

interface Ctx {
  branches: Record<string, string>;
  categories: Record<string, string>;
  users: Record<string, string>;
}

async function context(): Promise<Ctx> {
  const me = await call<{ organization: { code: string } }>('superadmin', 'GET', '/me');
  if (me.organization.code !== 'UAT')
    throw new Error('These logins do not belong to the UAT sample organisation; aborting');
  const branches = await call<{ id: string; code: string }[]>('superadmin', 'GET', '/branches');
  const categories = await call<{ id: string; code: string }[]>(
    'superadmin',
    'GET',
    '/asset-categories',
  );
  const users = await call<{ items: { id: string; email: string }[] }>(
    'superadmin',
    'GET',
    '/users?pageSize=100',
  );
  return {
    branches: Object.fromEntries(branches.map((b) => [b.code, b.id])),
    categories: Object.fromEntries(categories.map((c) => [c.code, c.id])),
    users: Object.fromEntries(users.items.map((u) => [u.email.split('@')[0] ?? '', u.id])),
  };
}

interface Intake {
  who: string;
  branch: string;
  customer: Json;
  device: { category: string; brand: string; model: string; serialNumber?: string };
  serviceType: 'IN_WARRANTY' | 'OUT_OF_WARRANTY' | 'WARRANTY_UNVERIFIED';
  complaint: string;
  accessories?: string[];
  onSite?: boolean;
}

async function intake(
  ctx: Ctx,
  i: Intake,
): Promise<{ id: string; customerId: string; jobNumber: string }> {
  const customer = await call<{ id: string }>(i.who, 'POST', '/customers', {
    type: 'INDIVIDUAL',
    consents: [
      { channel: 'WHATSAPP', purpose: 'SERVICE_UPDATES' },
      { channel: 'EMAIL', purpose: 'SERVICE_UPDATES' },
    ],
    ...i.customer,
  });
  const asset = await call<{ asset: { id: string } }>(i.who, 'POST', '/assets', {
    customerId: customer.id,
    categoryId: ctx.categories[i.device.category],
    brand: i.device.brand,
    model: i.device.model,
    ...(i.device.serialNumber ? { serialNumber: i.device.serialNumber } : {}),
  });
  const job = await call<{ id: string; jobNumber: string }>(
    i.who,
    'POST',
    '/jobs',
    {
      branchId: ctx.branches[i.branch],
      customerId: customer.id,
      assetId: asset.asset.id,
      serviceType: i.serviceType,
      serviceMode: i.onSite ? 'ON_SITE' : 'AT_SERVICE_CENTRE',
      complaint: i.complaint,
      accessoriesReceived: i.accessories ?? [],
      ...(i.onSite
        ? { serviceAddress: { line1: '14 Sample Street', city: 'Sample City', countryCode: 'IN' } }
        : {}),
    },
    { 'Idempotency-Key': key() },
  );
  return { id: job.id, customerId: customer.id, jobNumber: job.jobNumber };
}

async function diagnose(
  ctx: Ctx,
  id: string,
  tech: string,
  findings: string,
  assigner = 'manager',
) {
  await call(assigner, 'POST', `/jobs/${id}/assignments`, { technicianUserId: ctx.users[tech] });
  await move(id, tech, 'DIAGNOSIS');
  await call(tech, 'POST', `/jobs/${id}/diagnoses`, {
    symptom: 'As reported by the customer',
    findings,
    recommendation: 'Repair as estimated',
    internalNotes: 'UAT sample internal note — never shown to customers',
  });
}

/** Prepares and sends an estimate (sending moves the job to AWAITING_CUSTOMER_APPROVAL); returns the approval-link token. */
async function estimate(id: string, tech: string, lines: Json[]): Promise<string> {
  await move(id, tech, 'ESTIMATE_PREPARATION');
  const draft = await call<{ id: string; rowVersion: number }>(
    tech,
    'POST',
    `/jobs/${id}/estimates`,
    { lines, notes: 'Includes labour and a 90-day workmanship check.' },
  );
  const sent = await call<{ approvalLink: { token: string } }>(
    'manager',
    'POST',
    `/estimates/${draft.id}/send`,
    { rowVersion: draft.rowVersion },
  );
  return sent.approvalLink.token;
}

const decide = (linkToken: string, decision: 'APPROVED' | 'REJECTED') =>
  call(null, 'POST', '/public/estimate-links/decision', {
    token: linkToken,
    decision,
    termsAccepted: decision === 'APPROVED',
  });

async function complete(id: string, tech: string, summary: string) {
  await move(id, tech, 'QUALITY_CHECK');
  await call(tech, 'POST', `/jobs/${id}/completion`, {
    version: await version(id),
    repairSummary: summary,
    qcChecklist: QC_CHECKLIST.map((item) => ({ item, passed: true })),
  });
}

/** Prepares and issues the job's GST invoice as Accounts; returns its total. */
async function invoice(jobId: string): Promise<string> {
  const draft = await call<{ id: string }>('accounts', 'POST', `/jobs/${jobId}/invoices`);
  const issued = await call<{ total: string }>(
    'accounts',
    'POST',
    `/invoices/${draft.id}/issue`,
    undefined,
    { 'Idempotency-Key': key() },
  );
  return issued.total;
}

const pay = (
  ctx: Ctx,
  job: { id: string; customerId: string },
  branch: string,
  amount: string,
  method: string,
  reference?: string,
) =>
  call(
    'accounts',
    'POST',
    '/payments',
    {
      branchId: ctx.branches[branch],
      customerId: job.customerId,
      jobId: job.id,
      amount,
      method,
      ...(reference ? { reference } : {}),
    },
    { 'Idempotency-Key': key() },
  );

async function main() {
  const ctx = await context();
  const existing = await call<{ total: number }>('superadmin', 'GET', '/customers?pageSize=1');
  if (existing.total > 0) {
    console.log('UAT data already present; nothing to do.');
    return;
  }
  // Currency INR (owner default, ADR 0022). Sample business with a FICTITIOUS GSTIN (19AAAAA0000A1ZZ) —
  // never the real business details in UAT — and a tax approval explicitly marked as UAT-only.
  await call('superadmin', 'PUT', '/settings/money', {
    value: { currency: 'INR' },
    reason: 'UAT sample data',
  });
  await call('superadmin', 'PUT', '/settings/business', {
    value: {
      legalName: 'Sample Service Centre (UAT)',
      tradeName: null,
      gstin: '19AAAAA0000A1ZZ',
      address: {
        line1: '1 Sample Road',
        line2: null,
        city: 'Kolkata',
        stateCode: '19',
        postalCode: '700001',
      },
      phones: ['9800000000'],
      emails: ['uat@example.test'],
      website: null,
      signatoryName: null,
      signatoryDesignation: null,
    },
    reason: 'UAT sample business (fictitious)',
  });
  const tax = await call<{ tax: Record<string, unknown> }>('superadmin', 'GET', '/settings');
  await call('superadmin', 'PUT', '/settings/tax', {
    value: {
      ...tax.tax,
      status: 'APPROVED',
      approval: {
        approvedBy: 'UAT sample — NOT accountant-approved',
        approvedOn: new Date().toISOString().slice(0, 10),
        note: 'Test data only',
      },
    },
    reason: 'UAT sample data only',
  });

  const laptopLines = [
    { lineType: 'PART', description: 'Replacement keyboard', quantity: '1', unitPrice: '2400' },
    {
      lineType: 'LABOUR',
      description: 'Keyboard replacement labour',
      quantity: '1',
      unitPrice: '600',
    },
  ];

  // 1. Just received.
  await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Anil Kumar', phone: '+919800000101', email: 'anil.kumar@example.test' },
    device: {
      category: 'LAPTOP',
      brand: 'Lenovo',
      model: 'ThinkPad E14',
      serialNumber: 'PF-UAT-0101',
    },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Laptop does not power on after a power cut.',
    accessories: ['Charger'],
  });

  // 2. In diagnosis (warranty claim, branch 2).
  const j2 = await intake(ctx, {
    who: 'reception2',
    branch: 'UAT-2',
    customer: { name: 'Bhavna Shah', phone: '+919800000102' },
    device: {
      category: 'PRINTER',
      brand: 'HP',
      model: 'LaserJet M126nw',
      serialNumber: 'VNB-UAT-0102',
    },
    serviceType: 'IN_WARRANTY',
    complaint: 'Paper jams on every second page.',
  });
  // Branch 2 has no branch manager in the sample, so the Super Admin assigns.
  await diagnose(
    ctx,
    j2.id,
    'tech2',
    'Pickup roller worn; covered by manufacturer warranty.',
    'superadmin',
  );

  // 3. Awaiting customer approval.
  const j3 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Chitra Iyer', phone: '+919800000103', email: 'chitra.iyer@example.test' },
    device: {
      category: 'LAPTOP',
      brand: 'Dell',
      model: 'Inspiron 15 3520',
      serialNumber: 'DL-UAT-0103',
    },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Several keys do not respond.',
    accessories: ['Charger', 'Laptop bag'],
  });
  await diagnose(
    ctx,
    j3.id,
    'tech1',
    'Liquid damage under the keyboard; keyboard must be replaced.',
  );
  await estimate(j3.id, 'tech1', laptopLines);

  // 4. Approved, repair in progress.
  const j4 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Deepak Rao', phone: '+919800000104' },
    device: { category: 'DESKTOP', brand: 'Acer', model: 'Veriton X', serialNumber: 'AC-UAT-0104' },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Restarts randomly under load.',
  });
  await diagnose(ctx, j4.id, 'tech1', 'Power supply fan seized; PSU overheating.');
  const t4 = await estimate(j4.id, 'tech1', [
    { lineType: 'PART', description: '450 W power supply', quantity: '1', unitPrice: '2100' },
    { lineType: 'LABOUR', description: 'PSU replacement', quantity: '1', unitPrice: '400' },
  ]);
  await decide(t4, 'APPROVED');
  await move(j4.id, 'tech1', 'REPAIR_IN_PROGRESS');
  await call('tech1', 'POST', `/jobs/${j4.id}/work-logs`, {
    description: 'Old PSU removed, new unit fitted, burn-in test running.',
    durationMinutes: 45,
    visibility: 'CUSTOMER',
  });

  // 5. Waiting for parts.
  const j5 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Esha Menon', phone: '+919800000105' },
    device: {
      category: 'MONITOR',
      brand: 'Samsung',
      model: 'S24R350',
      serialNumber: 'SM-UAT-0105',
    },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Screen flickers and goes dark.',
  });
  await diagnose(ctx, j5.id, 'tech2', 'Backlight driver board failing.');
  const t5 = await estimate(j5.id, 'tech2', [
    { lineType: 'PART', description: 'Backlight driver board', quantity: '1', unitPrice: '1800' },
  ]);
  await decide(t5, 'APPROVED');
  await move(j5.id, 'tech2', 'WAITING_FOR_PARTS', {
    customerMessage: 'The replacement part has been ordered.',
  });

  // 6. Repair completed, part-paid.
  const j6 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Farhan Ali', phone: '+919800000106', email: 'farhan.ali@example.test' },
    device: { category: 'LAPTOP', brand: 'HP', model: 'Pavilion 14', serialNumber: 'HP-UAT-0106' },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Battery drains within 30 minutes.',
    accessories: ['Charger'],
  });
  await diagnose(ctx, j6.id, 'tech1', 'Battery health 41 %.');
  const t6 = await estimate(j6.id, 'tech1', [
    { lineType: 'PART', description: 'Battery 3-cell 41 Wh', quantity: '1', unitPrice: '3200' },
  ]);
  await decide(t6, 'APPROVED');
  await move(j6.id, 'tech1', 'REPAIR_IN_PROGRESS');
  await complete(j6.id, 'tech1', 'Battery replaced and calibrated; runtime now above 5 hours.');
  await invoice(j6.id); // 3776.00 incl. GST
  await pay(ctx, j6, 'UAT-1', '1000', 'UPI', 'UTR-UAT-0106');

  // 7. Ready for delivery, paid in full (split payment).
  const j7 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Gauri Patil', phone: '+919800000107' },
    device: { category: 'PRINTER', brand: 'Epson', model: 'L3250', serialNumber: 'EP-UAT-0107' },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Prints faded lines.',
  });
  await diagnose(ctx, j7.id, 'tech2', 'Clogged print head.');
  const t7 = await estimate(j7.id, 'tech2', [
    {
      lineType: 'LABOUR',
      description: 'Print head cleaning and alignment',
      quantity: '1',
      unitPrice: '750',
    },
  ]);
  await decide(t7, 'APPROVED');
  await move(j7.id, 'tech2', 'REPAIR_IN_PROGRESS');
  await complete(j7.id, 'tech2', 'Print head cleaned; nozzle check perfect.');
  await move(j7.id, 'tech2', 'READY_FOR_DELIVERY', {
    customerMessage: 'Your printer is ready for collection.',
  });
  await invoice(j7.id); // 885.00 incl. GST
  await pay(ctx, j7, 'UAT-1', '500', 'CASH');
  await pay(ctx, j7, 'UAT-1', '385', 'UPI', 'UTR-UAT-0107');

  // 8. Delivered (customer pick-up).
  const j8 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Harish Nair', phone: '+919800000108' },
    device: {
      category: 'LAPTOP',
      brand: 'Asus',
      model: 'VivoBook 15',
      serialNumber: 'AS-UAT-0108',
    },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Hinge broken on the left side.',
    accessories: ['Charger'],
  });
  await diagnose(ctx, j8.id, 'tech1', 'Left hinge bracket cracked.');
  const t8 = await estimate(j8.id, 'tech1', [
    { lineType: 'PART', description: 'Hinge kit', quantity: '1', unitPrice: '1500' },
    { lineType: 'LABOUR', description: 'Hinge replacement', quantity: '1', unitPrice: '500' },
  ]);
  await decide(t8, 'APPROVED');
  await move(j8.id, 'tech1', 'REPAIR_IN_PROGRESS');
  await complete(j8.id, 'tech1', 'Hinge kit replaced; lid opens and closes smoothly.');
  await move(j8.id, 'tech1', 'READY_FOR_DELIVERY');
  await invoice(j8.id); // 2360.00 incl. GST
  await pay(ctx, j8, 'UAT-1', '2360', 'CARD_TERMINAL', 'APPR-UAT-0108');
  await call(
    'delivery',
    'POST',
    `/jobs/${j8.id}/deliveries/handover`,
    {
      version: await version(j8.id),
      mode: 'CUSTOMER_PICKUP',
      recipientName: 'Harish Nair',
      relationship: 'SELF',
      items: [
        { description: 'Laptop: Asus VivoBook 15', returned: true },
        { description: 'Charger', returned: true },
      ],
      checklist: HANDOVER_CHECKLIST.map((item) => ({ item, checked: true })),
      proofMethod: 'SIGNED_CHALLAN',
    },
    { 'Idempotency-Key': key() },
  );

  // 9. On hold, 10. Cancelled, 11. Estimate rejected (return unrepaired), 12. On-site job.
  const j9 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Isha Kapoor', phone: '+919800000109' },
    device: {
      category: 'DESKTOP',
      brand: 'Lenovo',
      model: 'IdeaCentre 3',
      serialNumber: 'LN-UAT-0109',
    },
    serviceType: 'WARRANTY_UNVERIFIED',
    complaint: 'No display output.',
  });
  await move(j9.id, 'manager', 'ON_HOLD', {
    reason: 'Waiting for the customer to send the purchase invoice for warranty check.',
  });
  const j10 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Jatin Verma', phone: '+919800000110' },
    device: { category: 'MONITOR', brand: 'LG', model: '22MP410', serialNumber: 'LG-UAT-0110' },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Dead pixels.',
  });
  await move(j10.id, 'manager', 'CANCELLED', { reason: 'Customer decided to buy a new monitor.' });
  const j11 = await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: { name: 'Kiran Joshi', phone: '+919800000111' },
    device: { category: 'LAPTOP', brand: 'Acer', model: 'Aspire 7', serialNumber: 'AC-UAT-0111' },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Motherboard not detected by charger.',
    accessories: ['Charger'],
  });
  await diagnose(ctx, j11.id, 'tech2', 'Motherboard short; board replacement uneconomical.');
  const t11 = await estimate(j11.id, 'tech2', [
    { lineType: 'PART', description: 'Motherboard', quantity: '1', unitPrice: '14500' },
  ]);
  await decide(t11, 'REJECTED');
  await move(j11.id, 'tech2', 'READY_FOR_DELIVERY', {
    reason: 'Customer declined the estimate; returning unrepaired.',
  });
  await intake(ctx, {
    who: 'reception',
    branch: 'UAT-1',
    customer: {
      name: 'Lakshmi Traders (sample business)',
      type: 'BUSINESS',
      phone: '+919800000112',
      email: 'accounts@lakshmi-traders.example.test',
    },
    device: {
      category: 'PRINTER',
      brand: 'Canon',
      model: 'imageRUNNER 2206',
      serialNumber: 'CN-UAT-0112',
    },
    serviceType: 'OUT_OF_WARRANTY',
    complaint: 'Office copier shows error E000.',
    onSite: true,
  });

  // Inventory: parts with stock in both branches, one below its reorder level.
  const parts = [
    {
      sku: 'KB-UAT-01',
      name: 'Laptop keyboard (generic 15")',
      reorderLevel: '3',
      qty: '6',
      cost: '1500',
    },
    {
      sku: 'PSU-UAT-450',
      name: 'ATX power supply 450 W',
      reorderLevel: '2',
      qty: '3',
      cost: '1400',
    },
    {
      sku: 'BAT-UAT-41',
      name: 'Laptop battery 3-cell 41 Wh',
      reorderLevel: '4',
      qty: '2',
      cost: '2100',
    },
    { sku: 'HNG-UAT-01', name: 'Laptop hinge kit', reorderLevel: '2', qty: '5', cost: '900' },
  ];
  for (const p of parts) {
    const part = await call<{ id: string }>('manager', 'POST', '/parts', {
      sku: p.sku,
      name: p.name,
      reorderLevel: p.reorderLevel,
    });
    await call('manager', 'POST', '/inventory/receipts', {
      branchId: ctx.branches['UAT-1'],
      partId: part.id,
      quantity: p.qty,
      unitCost: p.cost,
    });
  }

  console.log(
    'UAT data created: 12 jobs across the lifecycle, 3 GST invoices, payments, a delivery, and stock for 4 parts.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
