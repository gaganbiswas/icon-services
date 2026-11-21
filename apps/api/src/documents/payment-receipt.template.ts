import { escapeHtml as e } from './html.js';
import type { ReceiptLayout } from './job-receipt.template.js';

export interface PaymentReceiptSnapshot {
  readonly business: {
    readonly name: string;
    readonly header: string;
    readonly branchName: string;
  };
  readonly receiptNumber: string;
  readonly receivedAt: string;
  readonly timeZone: string;
  readonly customer: { readonly name: string; readonly code: string };
  readonly jobNumber: string | null;
  readonly amount: string;
  readonly method: string;
  readonly reference: string | null;
  readonly status: 'RECORDED' | 'REVERSED';
  readonly reversalReason: string | null;
  readonly footer: string;
  readonly footerIsPlaceholder: boolean;
  readonly generatedAt: string;
}

/** Payment receipt (CLAUDE.md §4.8, §4.11). Not an invoice; every value escaped. */
export function renderPaymentReceiptHtml(s: PaymentReceiptSnapshot, layout: ReceiptLayout): string {
  const thermal = layout === 'THERMAL_80';
  const row = (label: string, value: string | null) =>
    value ? `<tr><th scope="row">${e(label)}</th><td>${e(value)}</td></tr>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Payment receipt ${e(s.receiptNumber)}</title>
<style>
  @page { size: ${thermal ? '80mm auto' : 'A4'}; margin: ${thermal ? '3mm' : '14mm'}; }
  body { font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', Arial, sans-serif; color: #000;
         font-size: ${thermal ? '9pt' : '11pt'}; line-height: 1.35; margin: 0; }
  header { border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .business { font-size: ${thermal ? '11pt' : '15pt'}; font-weight: 700; }
  h1 { font-size: ${thermal ? '11pt' : '14pt'}; margin: 8px 0; }
  .number { font-family: 'Noto Sans Mono', 'Courier New', monospace; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 3px 4px 3px 0; vertical-align: top; overflow-wrap: anywhere; }
  th { width: ${thermal ? '40%' : '30%'}; font-weight: 600; }
  .amount { font-size: ${thermal ? '13pt' : '18pt'}; font-weight: 700; }
  .reversed { border: 2px solid #000; padding: 6px; font-weight: 700; margin: 8px 0; }
  .footer { margin-top: 12px; font-size: ${thermal ? '8pt' : '9pt'}; white-space: pre-wrap; }
  .placeholder { border: 1px dashed #000; padding: 4px; font-style: italic; }
  .signature { margin-top: 32px; border-top: 1px solid #000; width: ${thermal ? '100%' : '50%'}; padding-top: 3px; }
</style>
</head>
<body>
<header>
  <div class="business">${e(s.business.name)}</div>
  ${s.business.header ? `<div>${e(s.business.header)}</div>` : ''}
  <div>${e(s.business.branchName)}</div>
</header>
<h1>Payment receipt <span class="number">${e(s.receiptNumber)}</span></h1>
${s.status === 'REVERSED' ? `<div class="reversed">REVERSED — this payment was reversed${s.reversalReason ? `: ${e(s.reversalReason)}` : ''}</div>` : ''}
<p class="amount">${e(s.amount)}</p>
<table>
  ${row('Received', `${s.receivedAt} (${s.timeZone})`)}
  ${row('From', `${s.customer.name} (${s.customer.code})`)}
  ${row('For job', s.jobNumber)}
  ${row('Method', s.method)}
  ${row('Reference', s.reference)}
</table>
<p>This is a receipt for money received. It is not an invoice.</p>
${s.footer ? `<div class="footer${s.footerIsPlaceholder ? ' placeholder' : ''}">${e(s.footer)}</div>` : ''}
<div class="signature">Received by</div>
<p class="footer">Generated ${e(s.generatedAt)}</p>
</body>
</html>`;
}
