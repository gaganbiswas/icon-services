import { describe, expect, it } from 'vitest';

import { type ReportTable, neutralize, toCsv, toHtml, toXlsx } from './report-table.js';

const table: ReportTable = {
  title: 'Job register',
  filters: 'All branches',
  notes: ['Interim figures'],
  columns: [
    { key: 'name', label: 'Customer', type: 'text' },
    { key: 'amount', label: 'Due', type: 'money' },
    { key: 'count', label: 'Jobs', type: 'integer' },
  ],
  rows: [
    { name: '=HYPERLINK("http://evil")', amount: '1300.5000', count: 2 },
    { name: 'Asha "AR", Rao\nशर्मा', amount: null, count: 0 },
  ],
};

describe('report exports', () => {
  it('neutralizes spreadsheet formulas', () => {
    expect(neutralize('=1+1')).toBe("'=1+1");
    expect(neutralize('+91 98123')).toBe("'+91 98123");
    expect(neutralize('-5')).toBe("'-5");
    expect(neutralize('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(neutralize('Asha')).toBe('Asha');
  });

  it('writes RFC 4180 CSV with BOM, quoting and injection guard; numbers stay numeric', () => {
    const csv = toCsv(table).toString('utf8');
    expect(csv.startsWith('﻿Customer,Due,Jobs\r\n')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")",1300.5000,2\r\n`);
    expect(csv).toContain('"Asha ""AR"", Rao\nशर्मा",,0\r\n');
  });

  it('produces a valid XLSX (zip) document', async () => {
    const xlsx = await toXlsx(table);
    expect(xlsx.subarray(0, 2).toString()).toBe('PK');
    expect(xlsx.length).toBeGreaterThan(1000);
  });

  it('escapes HTML for the PDF', () => {
    const html = toHtml(
      { ...table, rows: [{ name: '<script>x</script>', amount: '1', count: 1 }] },
      'Org <b>',
      '2026-11-19',
    );
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Org &lt;b&gt;');
  });
});
