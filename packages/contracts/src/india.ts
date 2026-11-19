/** GST state / union-territory codes (first two digits of a GSTIN). */
export const INDIAN_STATES = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
] as const;

export type IndianStateCode = (typeof INDIAN_STATES)[number]['code'];

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z]/g, '');

export function stateName(code: string): string | null {
  return INDIAN_STATES.find((s) => s.code === code)?.name ?? null;
}

/** Matches a free-text state name (e.g. "west bengal", "W Bengal" won't match) to its GST code. */
export function stateCodeFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = normalize(name);
  return INDIAN_STATES.find((s) => normalize(s.name) === n)?.code ?? null;
}

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** Format + check digit (mod-36 algorithm used by GSTN). */
export function isValidGstin(value: string): boolean {
  const g = value.trim().toUpperCase();
  if (!GSTIN_PATTERN.test(g)) return false;
  if (!stateName(g.slice(0, 2))) return false;
  let total = 0;
  for (let i = 0; i < 14; i += 1) {
    const product = GSTIN_CHARS.indexOf(g[i] ?? '0') * (i % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (total % 36)) % 36] === g[14];
}

export function stateCodeFromGstin(gstin: string | null | undefined): string | null {
  return gstin && isValidGstin(gstin) ? gstin.trim().slice(0, 2) : null;
}

/** Financial year containing `at` (start month 1–12, default April), in the business time zone. */
export function financialYear(
  at: Date,
  startMonth = 4,
  timeZone = 'UTC',
): { startYear: number; label: string; short: string } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(at);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const startYear = month >= startMonth ? year : year - 1;
  if (startMonth === 1)
    return { startYear, label: String(startYear), short: String(startYear % 100).padStart(2, '0') };
  const end = (startYear + 1) % 100;
  return {
    startYear,
    label: `${startYear}-${String(end).padStart(2, '0')}`,
    short: `${String(startYear % 100).padStart(2, '0')}${String(end).padStart(2, '0')}`,
  };
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  return n < 20
    ? (ONES[n] ?? '')
    : `${TENS[Math.floor(n / 10)] ?? ''}${n % 10 ? ` ${ONES[n % 10] ?? ''}` : ''}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h] ?? ''} Hundred` : '', r ? belowHundred(r) : ''].filter(Boolean).join(' ');
}

/** Indian numbering in words: 123456.5 → "One Lakh Twenty Three Thousand Four Hundred Fifty Six Rupees and Fifty Paise Only". */
export function amountInWordsINR(amount: string): string {
  const [rupeeText = '0', paiseText = ''] = amount.replace(/^-/, '').split('.');
  let rupees = Number(rupeeText);
  const paise = Math.round(Number(`0.${paiseText || '0'}`) * 100);
  const groups: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  rupees %= 10_000_000;
  const lakh = Math.floor(rupees / 100_000);
  rupees %= 100_000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  if (crore)
    groups.push(
      `${crore >= 1000 ? amountInWordsINR(String(crore)).replace(/ Rupees.*$/, '') : belowThousand(crore)} Crore`,
    );
  if (lakh) groups.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) groups.push(`${belowHundred(thousand)} Thousand`);
  if (rupees) groups.push(belowThousand(rupees));
  const words = groups.join(' ') || 'Zero';
  return `${words} Rupees${paise ? ` and ${belowHundred(paise)} Paise` : ''} Only`;
}
