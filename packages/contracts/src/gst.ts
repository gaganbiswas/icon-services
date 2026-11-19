import { Decimal } from 'decimal.js';

/**
 * GST invoice calculation (ADR 0022). Pure and decimal-safe (never JS floats).
 * Defaults, all configurable: tax-exclusive prices; each component per line
 * rounded half-up to paise; grand total rounded half-up to the rupee with a
 * separate round-off amount. Intra-state → CGST + SGST (rate split equally);
 * inter-state → IGST.
 */
export type SupplyType = 'INTRA_STATE' | 'INTER_STATE';
export type RoundOff = 'NEAREST_RUPEE' | 'NONE';

export interface GstLineInput {
  quantity: string;
  unitPrice: string;
  discount: string;
  /** Percent, e.g. "18". */
  gstRate: string;
}

export interface GstLineResult {
  taxableValue: string;
  cgstRate: string;
  sgstRate: string;
  igstRate: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
  lineTotal: string;
}

export interface GstTotals {
  taxableTotal: string;
  cgstTotal: string;
  sgstTotal: string;
  igstTotal: string;
  taxTotal: string;
  roundOff: string;
  total: string;
}

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const paise = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fmt = (d: Decimal) => d.toFixed(2);

export class GstInputError extends Error {}

export function computeGstLine(line: GstLineInput, supply: SupplyType): GstLineResult {
  const quantity = new D(line.quantity);
  const unitPrice = new D(line.unitPrice);
  const discount = new D(line.discount);
  const rate = new D(line.gstRate);
  if (quantity.lte(0) || unitPrice.lt(0) || discount.lt(0) || rate.lt(0) || rate.gt(100)) {
    throw new GstInputError('Invalid quantity, price, discount or rate');
  }
  const gross = quantity.times(unitPrice);
  if (discount.gt(gross)) throw new GstInputError('Discount exceeds the line amount');
  const taxable = paise(gross.minus(discount));
  const half = rate.dividedBy(2);
  const cgst = supply === 'INTRA_STATE' ? paise(taxable.times(half).dividedBy(100)) : new D(0);
  const sgst = supply === 'INTRA_STATE' ? paise(taxable.times(half).dividedBy(100)) : new D(0);
  const igst = supply === 'INTER_STATE' ? paise(taxable.times(rate).dividedBy(100)) : new D(0);
  return {
    taxableValue: fmt(taxable),
    cgstRate: supply === 'INTRA_STATE' ? half.toString() : '0',
    sgstRate: supply === 'INTRA_STATE' ? half.toString() : '0',
    igstRate: supply === 'INTER_STATE' ? rate.toString() : '0',
    cgstAmount: fmt(cgst),
    sgstAmount: fmt(sgst),
    igstAmount: fmt(igst),
    lineTotal: fmt(taxable.plus(cgst).plus(sgst).plus(igst)),
  };
}

export function computeGstTotals(lines: readonly GstLineResult[], roundOff: RoundOff): GstTotals {
  const sum = (k: keyof GstLineResult) => lines.reduce((acc, l) => acc.plus(l[k]), new D(0));
  const taxable = sum('taxableValue');
  const cgst = sum('cgstAmount');
  const sgst = sum('sgstAmount');
  const igst = sum('igstAmount');
  const exact = taxable.plus(cgst).plus(sgst).plus(igst);
  const total =
    roundOff === 'NEAREST_RUPEE' ? exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) : exact;
  return {
    taxableTotal: fmt(taxable),
    cgstTotal: fmt(cgst),
    sgstTotal: fmt(sgst),
    igstTotal: fmt(igst),
    taxTotal: fmt(cgst.plus(sgst).plus(igst)),
    roundOff: fmt(total.minus(exact)),
    total: fmt(total),
  };
}

/** HSN/SAC + rate summary required on GST invoices and returns. */
export function summarizeByHsn(
  lines: readonly (GstLineResult & { hsnSac: string; gstRate: string })[],
): {
  hsnSac: string;
  gstRate: string;
  taxableValue: string;
  cgstAmount: string;
  sgstAmount: string;
  igstAmount: string;
}[] {
  const groups = new Map<
    string,
    { hsnSac: string; gstRate: string; t: Decimal; c: Decimal; s: Decimal; i: Decimal }
  >();
  for (const l of lines) {
    const key = `${l.hsnSac}|${new D(l.gstRate).toString()}`;
    const g = groups.get(key) ?? {
      hsnSac: l.hsnSac,
      gstRate: new D(l.gstRate).toString(),
      t: new D(0),
      c: new D(0),
      s: new D(0),
      i: new D(0),
    };
    g.t = g.t.plus(l.taxableValue);
    g.c = g.c.plus(l.cgstAmount);
    g.s = g.s.plus(l.sgstAmount);
    g.i = g.i.plus(l.igstAmount);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => a.hsnSac.localeCompare(b.hsnSac) || new D(a.gstRate).cmp(b.gstRate))
    .map((g) => ({
      hsnSac: g.hsnSac,
      gstRate: g.gstRate,
      taxableValue: fmt(g.t),
      cgstAmount: fmt(g.c),
      sgstAmount: fmt(g.s),
      igstAmount: fmt(g.i),
    }));
}

/** Intra-state when the recipient's state equals the supplier's (ADR 0022). */
export function supplyTypeFor(supplierStateCode: string, placeOfSupplyCode: string): SupplyType {
  return supplierStateCode === placeOfSupplyCode ? 'INTRA_STATE' : 'INTER_STATE';
}
