import { escapeHtml as e } from './html.js';

export interface DocParty {
  readonly name: string;
  readonly gstin: string | null;
  readonly address: string;
  readonly stateCode: string;
  readonly stateName: string;
}

export interface TaxDocLine {
  readonly description: string;
  readonly hsnSac: string;
  readonly quantity: string;
  readonly unit: string;
  readonly unitPrice?: string;
  readonly discount?: string;
  readonly taxableValue: string;
  readonly gstRate: string;
  readonly cgstAmount: string;
  readonly sgstAmount: string;
  readonly igstAmount: string;
}

export interface TaxDocSnapshot {
  readonly kind: 'TAX_INVOICE' | 'BILL_OF_SUPPLY' | 'CREDIT_NOTE';
  /** Credit note against a Bill of Supply: printed without GST columns. */
  readonly withoutGst?: boolean;
  readonly number: string;
  readonly date: string;
  readonly reference: { readonly label: string; readonly value: string } | null;
  readonly reason: string | null;
  readonly supplier: DocParty;
  readonly recipient: DocParty;
  readonly supplyType: 'INTRA_STATE' | 'INTER_STATE';
  readonly placeOfSupply: { readonly code: string; readonly name: string };
  readonly jobNumber: string;
  readonly currency: string;
  readonly lines: readonly TaxDocLine[];
  readonly hsnSummary: readonly {
    hsnSac: string;
    gstRate: string;
    taxableValue: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
  }[];
  readonly totals: {
    readonly taxable: string;
    readonly cgst: string;
    readonly sgst: string;
    readonly igst: string;
    readonly roundOff: string;
    readonly total: string;
  };
  readonly amountInWords: string;
  readonly terms: string | null;
  readonly termsArePlaceholder: boolean;
  readonly declaration: string | null;
  readonly signatory: { readonly name: string | null; readonly designation: string | null };
  readonly contact: string;
  readonly generatedAt: string;
}

const half = (rate: string) => String(Number(rate) / 2);

const TITLES = {
  TAX_INVOICE: 'Tax Invoice',
  BILL_OF_SUPPLY: 'Bill of Supply',
  CREDIT_NOTE: 'Credit Note',
} as const;

/**
 * GST tax invoice, Bill of Supply (no GST, ADR 0024) or credit note (ADR 0022
 * field list). A4, grayscale-friendly, every value escaped. Reprints use the
 * stored snapshot, so values never change.
 */
export function renderTaxDocumentHtml(s: TaxDocSnapshot): string {
  const intra = s.supplyType === 'INTRA_STATE';
  const gst = s.kind !== 'BILL_OF_SUPPLY' && s.withoutGst !== true;
  const invoiceLike = s.kind !== 'CREDIT_NOTE';
  const title = TITLES[s.kind];
  const party = (label: string, p: DocParty) => `
    <div class="party">
      <div class="label">${e(label)}</div>
      <div class="name">${e(p.name)}</div>
      ${p.address ? `<div>${e(p.address)}</div>` : ''}
      <div>GSTIN: ${p.gstin ? `<strong>${e(p.gstin)}</strong>` : 'Unregistered'}</div>
      <div>State: ${e(p.stateName)} (code ${e(p.stateCode)})</div>
    </div>`;
  const taxHead = !gst
    ? ''
    : intra
      ? '<th class="num">CGST</th><th class="num">SGST</th>'
      : '<th class="num">IGST</th>';
  const taxCells = (l: {
    gstRate: string;
    cgstAmount: string;
    sgstAmount: string;
    igstAmount: string;
  }) =>
    !gst
      ? ''
      : intra
        ? `<td class="num">${e(l.cgstAmount)}<br><span class="rate">@${e(half(l.gstRate))}%</span></td><td class="num">${e(l.sgstAmount)}<br><span class="rate">@${e(half(l.gstRate))}%</span></td>`
        : `<td class="num">${e(l.igstAmount)}<br><span class="rate">@${e(l.gstRate)}%</span></td>`;
  const lines = s.lines
    .map(
      (l, i) => `<tr>
        <td>${i + 1}</td>
        <td>${e(l.description)}</td>
        <td>${e(l.hsnSac)}</td>
        <td class="num">${e(l.quantity)} ${e(l.unit)}</td>
        ${invoiceLike ? `<td class="num">${e(l.unitPrice ?? '')}</td><td class="num">${e(l.discount ?? '')}</td>` : ''}
        <td class="num">${e(l.taxableValue)}</td>
        ${taxCells(l)}
      </tr>`,
    )
    .join('');
  const hsn = s.hsnSummary
    .map(
      (h) =>
        `<tr><td>${e(h.hsnSac)}</td><td class="num">${e(h.gstRate)}%</td><td class="num">${e(h.taxableValue)}</td>${
          intra
            ? `<td class="num">${e(h.cgstAmount)}</td><td class="num">${e(h.sgstAmount)}</td>`
            : `<td class="num">${e(h.igstAmount)}</td>`
        }</tr>`,
    )
    .join('');
  const total = (label: string, value: string, strong = false) =>
    `<tr${strong ? ' class="grand"' : ''}><th scope="row">${e(label)}</th><td class="num">${e(value)}</td></tr>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(title)} ${e(s.number)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font-family: 'Noto Sans', 'Noto Sans Bengali', Arial, sans-serif; color: #000; font-size: 9.5pt; line-height: 1.35; margin: 0; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1.5px solid #000; padding-bottom: 6px; }
  .supplier .name { font-size: 15pt; font-weight: 700; }
  h1 { font-size: 14pt; margin: 0; text-align: right; }
  .meta { text-align: right; }
  .number { font-family: 'Noto Sans Mono', 'Courier New', monospace; font-weight: 700; }
  .parties { display: flex; gap: 12px; margin: 8px 0; }
  .party { flex: 1; border: 1px solid #000; padding: 5px 7px; }
  .label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .party .name { font-weight: 700; font-size: 11pt; }
  table { width: 100%; border-collapse: collapse; }
  .items th, .items td, .hsn th, .hsn td { border: 0.6pt solid #000; padding: 3px 4px; vertical-align: top; overflow-wrap: anywhere; }
  .items thead, .hsn thead { display: table-header-group; }
  .items tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .rate { font-size: 7.5pt; }
  .totals { width: 45%; margin-left: auto; margin-top: 6px; }
  .totals th, .totals td { padding: 2px 4px; text-align: left; }
  .totals .num { text-align: right; }
  .grand th, .grand td { font-weight: 700; font-size: 11pt; border-top: 1.2pt solid #000; }
  .words { margin: 6px 0; }
  .small { font-size: 8pt; }
  .terms { white-space: pre-wrap; margin-top: 8px; }
  .placeholder { border: 1px dashed #000; padding: 4px; font-style: italic; }
  .sign { margin-top: 26px; text-align: right; }
  .sign .line { display: inline-block; border-top: 1px solid #000; padding-top: 3px; min-width: 55mm; text-align: center; }
  .reason { border: 1px solid #000; padding: 4px 6px; margin: 6px 0; }
</style>
</head>
<body>
<div class="top">
  <div class="supplier">
    <div class="name">${e(s.supplier.name)}</div>
    <div>${e(s.supplier.address)}</div>
    <div>GSTIN: <strong>${e(s.supplier.gstin ?? '')}</strong> · State: ${e(s.supplier.stateName)} (${e(s.supplier.stateCode)})</div>
    ${s.contact ? `<div class="small">${e(s.contact)}</div>` : ''}
  </div>
  <div class="meta">
    <h1>${e(title)}</h1>
    <div>No. <span class="number">${e(s.number)}</span></div>
    <div>Date: ${e(s.date)}</div>
    ${s.reference ? `<div>${e(s.reference.label)}: <span class="number">${e(s.reference.value)}</span></div>` : ''}
    <div>Job: ${e(s.jobNumber)}</div>
  </div>
</div>
<div class="parties">
  ${party(invoiceLike ? 'Bill to' : 'Issued to', s.recipient)}
  <div class="party">
    <div class="label">Supply</div>
    <div>Place of supply: <strong>${e(s.placeOfSupply.name)} (${e(s.placeOfSupply.code)})</strong></div>
    <div>${!gst ? 'No GST charged' : intra ? 'Intra-state supply (CGST + SGST)' : 'Inter-state supply (IGST)'}</div>
    ${gst ? '<div>Reverse charge: No</div>' : ''}
    <div>Currency: ${e(s.currency)}</div>
  </div>
</div>
${s.reason ? `<div class="reason">Reason: ${e(s.reason)}</div>` : ''}
<table class="items">
  <thead><tr>
    <th>#</th><th>Description</th><th>HSN/SAC</th><th class="num">Qty</th>
    ${invoiceLike ? '<th class="num">Rate</th><th class="num">Discount</th>' : ''}
    <th class="num">${gst ? 'Taxable value' : 'Value'}</th>${taxHead}
  </tr></thead>
  <tbody>${lines}</tbody>
</table>
<table class="totals">
  ${total(gst ? 'Taxable value' : 'Value', s.totals.taxable)}
  ${!gst ? '' : intra ? `${total('CGST', s.totals.cgst)}${total('SGST', s.totals.sgst)}` : total('IGST', s.totals.igst)}
  ${s.totals.roundOff !== '0.00' ? total('Round off', s.totals.roundOff) : ''}
  ${total(invoiceLike ? `Total (${s.currency})` : `Credit total (${s.currency})`, s.totals.total, true)}
</table>
<p class="words"><strong>Amount in words:</strong> ${e(s.amountInWords)}</p>
${
  gst
    ? `<table class="hsn small">
  <thead><tr><th>HSN/SAC</th><th class="num">GST rate</th><th class="num">Taxable value</th>${intra ? '<th class="num">CGST</th><th class="num">SGST</th>' : '<th class="num">IGST</th>'}</tr></thead>
  <tbody>${hsn}</tbody>
</table>`
    : ''
}
${s.terms ? `<div class="terms small${s.termsArePlaceholder ? ' placeholder' : ''}">${e(s.terms)}</div>` : ''}
${s.declaration ? `<p class="small">${e(s.declaration)}</p>` : ''}
<div class="sign">
  <div>For ${e(s.supplier.name)}</div>
  <br><br>
  <div class="line">${e(s.signatory.name ?? '')}${s.signatory.name ? '<br>' : ''}${e(s.signatory.designation ?? 'Authorised Signatory')}</div>
</div>
<p class="small">Generated ${e(s.generatedAt)}. This is a computer-generated ${e(title.toLowerCase())}.</p>
</body>
</html>`;
}
