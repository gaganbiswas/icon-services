import { escapeHtml as e } from './html.js';

export interface JobReceiptSnapshot {
  readonly business: {
    readonly name: string;
    readonly header: string;
    readonly branchName: string;
    readonly branchAddress: string | null;
    readonly branchPhone: string | null;
  };
  readonly job: {
    readonly number: string;
    readonly receivedAt: string;
    readonly timeZone: string;
    readonly serviceType: string;
    readonly serviceMode: string;
    readonly status: string;
    readonly expectedCompletionDate: string | null;
  };
  readonly customer: {
    readonly name: string;
    readonly code: string;
    readonly phone: string;
    readonly email: string | null;
  };
  readonly device: {
    readonly category: string;
    readonly brand: string;
    readonly model: string;
    readonly serialNumber: string | null;
    readonly assetTag: string | null;
  };
  readonly complaint: string;
  readonly accessories: readonly string[];
  readonly checklist: readonly { item: string; checked: boolean; note?: string | undefined }[];
  readonly conditionNotes: string | null;
  readonly terms: string;
  readonly termsArePlaceholder: boolean;
  readonly generatedAt: string;
}

export type ReceiptLayout = 'A4' | 'THERMAL_80';

const row = (label: string, value: string | null | undefined) =>
  value ? `<tr><th scope="row">${e(label)}</th><td>${e(value)}</td></tr>` : '';

/**
 * Printable job receipt (CLAUDE.md §4.11). Pure function of the immutable
 * snapshot; every value is escaped. Grayscale-friendly, no external assets.
 */
export function renderJobReceiptHtml(s: JobReceiptSnapshot, layout: ReceiptLayout): string {
  const thermal = layout === 'THERMAL_80';
  const checklist = s.checklist.length
    ? `<h2>Intake checklist</h2><ul class="checklist">${s.checklist
        .map(
          (c) =>
            `<li><span aria-hidden="true">${c.checked ? '[x]' : '[ ]'}</span> ${e(c.item)}${c.note ? ` — ${e(c.note)}` : ''}</li>`,
        )
        .join('')}</ul>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Job receipt ${e(s.job.number)}</title>
<style>
  @page { size: ${thermal ? '80mm auto' : 'A4'}; margin: ${thermal ? '3mm' : '14mm'}; }
  * { box-sizing: border-box; }
  body { font-family: 'Noto Sans', 'Noto Sans Devanagari', 'Noto Sans Bengali', Arial, sans-serif; color: #000;
         font-size: ${thermal ? '9pt' : '10.5pt'}; line-height: 1.35; margin: 0; }
  header { border-bottom: 1.5px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
  .business { font-size: ${thermal ? '11pt' : '15pt'}; font-weight: 700; }
  .doc-title { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
  .doc-title strong { font-size: ${thermal ? '10pt' : '13pt'}; }
  .job-number { font-family: 'Noto Sans Mono', 'Courier New', monospace; font-size: ${thermal ? '11pt' : '14pt'}; font-weight: 700; }
  h2 { font-size: ${thermal ? '9.5pt' : '11pt'}; margin: 10px 0 4px; border-bottom: 1px solid #999; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 2px 4px 2px 0; overflow-wrap: anywhere; }
  th { width: ${thermal ? '38%' : '28%'}; font-weight: 600; }
  .grid { display: ${thermal ? 'block' : 'grid'}; grid-template-columns: 1fr 1fr; gap: 0 16px; }
  .complaint { white-space: pre-wrap; overflow-wrap: anywhere; border: 1px solid #999; padding: 6px; }
  .checklist { list-style: none; padding: 0; margin: 0; }
  .terms { font-size: ${thermal ? '8pt' : '9pt'}; white-space: pre-wrap; }
  .placeholder { border: 1px dashed #000; padding: 4px; font-style: italic; }
  .signatures { display: ${thermal ? 'block' : 'grid'}; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 28px; }
  .signature { border-top: 1px solid #000; padding-top: 3px; margin-top: ${thermal ? '22px' : '0'}; }
  footer { margin-top: 10px; font-size: 8pt; color: #333; }
  section { break-inside: avoid; }
</style>
</head>
<body>
<header>
  <div class="business">${e(s.business.name)}</div>
  ${s.business.header ? `<div>${e(s.business.header)}</div>` : ''}
  <div>${e(s.business.branchName)}${s.business.branchAddress ? ` · ${e(s.business.branchAddress)}` : ''}${s.business.branchPhone ? ` · ${e(s.business.branchPhone)}` : ''}</div>
</header>
<div class="doc-title"><strong>Job receipt — customer copy</strong><span class="job-number">${e(s.job.number)}</span></div>
<div class="grid">
<section>
  <h2>Customer</h2>
  <table>${row('Name', s.customer.name)}${row('Customer code', s.customer.code)}${row('Phone', s.customer.phone)}${row('Email', s.customer.email)}</table>
</section>
<section>
  <h2>Job</h2>
  <table>${row('Received', `${s.job.receivedAt} (${s.job.timeZone})`)}${row('Service type', s.job.serviceType)}${row('Service mode', s.job.serviceMode)}${row('Status', s.job.status)}${row('Expected completion', s.job.expectedCompletionDate)}</table>
</section>
</div>
<section>
  <h2>Device</h2>
  <table>${row('Category', s.device.category)}${row('Brand / model', `${s.device.brand} ${s.device.model}`)}${row('Serial number', s.device.serialNumber)}${row('Asset tag', s.device.assetTag)}</table>
</section>
<section>
  <h2>Reported problem</h2>
  <div class="complaint">${e(s.complaint)}</div>
</section>
<section>
  <h2>Accessories received</h2>
  <div>${s.accessories.length ? s.accessories.map(e).join(', ') : 'None'}</div>
  ${s.conditionNotes ? `<h2>Condition at intake</h2><div class="complaint">${e(s.conditionNotes)}</div>` : ''}
  ${checklist}
</section>
<section>
  <h2>Terms</h2>
  <div class="terms${s.termsArePlaceholder ? ' placeholder' : ''}">${e(s.terms)}</div>
</section>
<section class="signatures">
  <div class="signature">Customer signature</div>
  <div class="signature">Received by (staff)</div>
</section>
<footer>Generated ${e(s.generatedAt)} · Keep this receipt to collect your device.</footer>
</body>
</html>`;
}
