import { escapeHtml as e } from './html.js';
import type { ReceiptLayout } from './job-receipt.template.js';

export interface DeliveryChallanSnapshot {
  readonly business: {
    readonly name: string;
    readonly header: string;
    readonly branchName: string;
    readonly branchAddress: string | null;
    readonly branchPhone: string | null;
  };
  readonly challanNumber: string;
  readonly status: 'DISPATCHED' | 'COMPLETED' | 'FAILED';
  readonly mode: string;
  readonly date: string;
  readonly timeZone: string;
  readonly customer: { readonly name: string; readonly code: string; readonly phone: string };
  readonly address: string | null;
  readonly jobNumber: string;
  readonly device: { readonly description: string; readonly serialNumber: string | null };
  readonly items: readonly { description: string; returned: boolean; condition: string | null }[];
  readonly recipient: {
    readonly name: string;
    readonly relationship: string;
    readonly authorizationNote: string | null;
  } | null;
  readonly balanceStatus: string;
  readonly terms: string;
  readonly termsArePlaceholder: boolean;
  readonly generatedAt: string;
}

/** Delivery challan (CLAUDE.md §4.9): a hand-over document — not an invoice, not proof of payment. */
export function renderDeliveryChallanHtml(
  s: DeliveryChallanSnapshot,
  layout: ReceiptLayout,
): string {
  const thermal = layout === 'THERMAL_80';
  const row = (label: string, value: string | null) =>
    value ? `<tr><th scope="row">${e(label)}</th><td>${e(value)}</td></tr>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Delivery challan ${e(s.challanNumber)}</title>
<style>
  @page { size: ${thermal ? '80mm auto' : 'A4'}; margin: ${thermal ? '3mm' : '14mm'}; }
  body { font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', Arial, sans-serif; color: #000;
         font-size: ${thermal ? '9pt' : '10.5pt'}; line-height: 1.35; margin: 0; }
  header { border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .business { font-size: ${thermal ? '11pt' : '15pt'}; font-weight: 700; }
  h1 { font-size: ${thermal ? '11pt' : '14pt'}; margin: 8px 0; }
  .number { font-family: 'Noto Sans Mono', 'Courier New', monospace; font-weight: 700; }
  h2 { font-size: ${thermal ? '9.5pt' : '11pt'}; margin: 10px 0 4px; border-bottom: 1px solid #999; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 2px 4px 2px 0; vertical-align: top; overflow-wrap: anywhere; }
  th { width: ${thermal ? '40%' : '28%'}; font-weight: 600; }
  .items td, .items th { border-bottom: 1px solid #ccc; width: auto; }
  .notice { border: 1.5px solid #000; padding: 6px; font-weight: 700; margin: 8px 0; }
  .terms { font-size: ${thermal ? '8pt' : '9pt'}; white-space: pre-wrap; }
  .placeholder { border: 1px dashed #000; padding: 4px; font-style: italic; }
  .signatures { display: ${thermal ? 'block' : 'grid'}; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 30px; }
  .signature { border-top: 1px solid #000; padding-top: 3px; margin-top: ${thermal ? '22px' : '0'}; }
  section { break-inside: avoid; }
</style>
</head>
<body>
<header>
  <div class="business">${e(s.business.name)}</div>
  ${s.business.header ? `<div>${e(s.business.header)}</div>` : ''}
  <div>${e(s.business.branchName)}${s.business.branchAddress ? ` · ${e(s.business.branchAddress)}` : ''}${s.business.branchPhone ? ` · ${e(s.business.branchPhone)}` : ''}</div>
</header>
<h1>Delivery challan <span class="number">${e(s.challanNumber)}</span></h1>
<div class="notice">Hand-over document — not an invoice and not proof of payment.</div>
${s.status === 'FAILED' ? '<div class="notice">DELIVERY ATTEMPT FAILED — device returned to the service centre.</div>' : ''}
<section>
  <table>
    ${row('Date', `${s.date} (${s.timeZone})`)}
    ${row('Job', s.jobNumber)}
    ${row('Delivery mode', s.mode)}
    ${row('Customer', `${s.customer.name} (${s.customer.code}) · ${s.customer.phone}`)}
    ${row('Address', s.address)}
    ${row('Device', s.device.description)}
    ${row('Serial number', s.device.serialNumber)}
    ${row('Balance status', s.balanceStatus)}
  </table>
</section>
<section>
  <h2>Items</h2>
  <table class="items">
    <thead><tr><th scope="col">Item</th><th scope="col">Returned</th><th scope="col">Condition</th></tr></thead>
    <tbody>${s.items.map((i) => `<tr><td>${e(i.description)}</td><td>${i.returned ? 'Yes' : 'No'}</td><td>${e(i.condition ?? '')}</td></tr>`).join('')}</tbody>
  </table>
</section>
${s.recipient ? `<section><h2>Received by</h2><table>${row('Name', s.recipient.name)}${row('Relationship', s.recipient.relationship)}${row('Authorization', s.recipient.authorizationNote)}</table></section>` : ''}
<section>
  <h2>Terms</h2>
  <div class="terms${s.termsArePlaceholder ? ' placeholder' : ''}">${e(s.terms)}</div>
</section>
<section class="signatures">
  <div class="signature">Recipient signature</div>
  <div class="signature">Handed over by (staff)</div>
</section>
<p class="terms">Generated ${e(s.generatedAt)}</p>
</body>
</html>`;
}
