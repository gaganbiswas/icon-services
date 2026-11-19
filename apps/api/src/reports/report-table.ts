import writeXlsxFile, { type Row, type SheetData } from 'write-excel-file/node';

import { escapeHtml } from '../documents/html.js';

export type ColumnType = 'text' | 'integer' | 'money' | 'quantity' | 'datetime' | 'date';

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly type: ColumnType;
}

/** A report flattened for export. Values are strings (decimal money as text), numbers or null. */
export interface ReportTable {
  readonly title: string;
  /** Human-readable filter summary printed in the header of exports. */
  readonly filters: string;
  /** Notes printed under the table (e.g. interim basis). */
  readonly notes?: readonly string[];
  readonly columns: readonly ReportColumn[];
  readonly rows: readonly Record<string, string | number | null>[];
}

/**
 * Spreadsheet formula injection guard (OWASP): text starting with = + - @ tab or CR
 * is prefixed with an apostrophe so spreadsheet apps never evaluate it.
 */
export function neutralize(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function textOf(column: ReportColumn, value: string | number | null): string {
  if (value === null || value === undefined) return '';
  if (column.type === 'text' || column.type === 'datetime' || column.type === 'date')
    return neutralize(String(value));
  return String(value);
}

/** RFC 4180 CSV with a UTF-8 BOM so spreadsheet apps detect Unicode. */
export function toCsv(table: ReportTable): Buffer {
  const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [table.columns.map((c) => quote(neutralize(c.label))).join(',')];
  for (const row of table.rows)
    lines.push(table.columns.map((c) => quote(textOf(c, row[c.key] ?? null))).join(','));
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

/**
 * XLSX for analysis. Money/quantities become spreadsheet numbers (display only;
 * the system's decimal values remain the source of truth). Text cells are typed
 * as strings, so formulas are never created from data.
 */
export async function toXlsx(table: ReportTable): Promise<Buffer> {
  const header: Row = table.columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const }));
  const data: SheetData = [
    [{ value: table.title, fontWeight: 'bold' as const }],
    [{ value: neutralize(table.filters), type: String }],
    [],
    header,
  ];
  for (const row of table.rows) {
    data.push(
      table.columns.map((c) => {
        const value = row[c.key] ?? null;
        if (value === null || value === '') return null;
        switch (c.type) {
          case 'money':
            return { value: Number(value), type: Number, format: '#,##0.00##' };
          case 'quantity':
            return { value: Number(value), type: Number, format: '#,##0.####' };
          case 'integer':
            return { value: Number(value), type: Number };
          default:
            return { value: textOf(c, value), type: String };
        }
      }),
    );
  }
  for (const note of table.notes ?? []) data.push([], [{ value: neutralize(note), type: String }]);
  return writeXlsxFile(data, { sheet: 'Report', stickyRowsCount: 4 }).toBuffer();
}

/** Printable HTML for the PDF renderer (A4 landscape, grayscale-friendly). */
export function toHtml(table: ReportTable, organizationName: string, generatedAt: string): string {
  const head = table.columns
    .map((c) => `<th class="${c.type}">${escapeHtml(c.label)}</th>`)
    .join('');
  const body = table.rows
    .map(
      (row) =>
        `<tr>${table.columns.map((c) => `<td class="${c.type}">${escapeHtml(textOf(c, row[c.key] ?? null))}</td>`).join('')}</tr>`,
    )
    .join('');
  const notes = (table.notes ?? []).map((n) => `<p class="note">${escapeHtml(n)}</p>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(table.title)}</title><style>
@page { size: A4 landscape; margin: 12mm; }
body { font-family: Arial, 'Noto Sans', sans-serif; font-size: 9pt; color: #000; }
h1 { font-size: 13pt; margin: 0 0 2mm; }
.meta { margin: 0 0 4mm; color: #333; }
table { width: 100%; border-collapse: collapse; }
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
th, td { border: 0.5pt solid #777; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #e6e6e6; }
td.money, td.quantity, td.integer, th.money, th.quantity, th.integer { text-align: right; white-space: nowrap; }
.note { margin-top: 3mm; font-style: italic; }
</style></head><body>
<h1>${escapeHtml(table.title)}</h1>
<p class="meta">${escapeHtml(organizationName)} · ${escapeHtml(table.filters)} · Generated ${escapeHtml(generatedAt)} · ${table.rows.length} row(s)</p>
<table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${table.columns.length}">No rows.</td></tr>`}</tbody></table>
${notes}
</body></html>`;
}
