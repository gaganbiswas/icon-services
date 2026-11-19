import type { ExportableReport } from '@icon/contracts';
import { useState } from 'react';

import { useAuth } from '../lib/auth';
import { formMessage } from '../lib/form-errors';
import { useCan } from '../lib/permissions';

/** Saves a blob through a temporary link (no permanent URL is kept). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const FORMATS = [
  ['csv', 'CSV'],
  ['xlsx', 'Excel'],
  ['pdf', 'PDF'],
] as const;

/** CSV / Excel / PDF export of a report with the current filters. Exports are audited. */
export function ExportButtons({
  report,
  query,
}: {
  report: ExportableReport;
  query: Record<string, string | undefined>;
}) {
  const { client } = useAuth();
  const canExport = useCan('reports.export');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!canExport) return null;

  async function run(format: string) {
    setBusy(format);
    setError(null);
    try {
      const { blob, filename } = await client.download(`/reports/${report}/export`, {
        ...query,
        format,
      });
      saveBlob(blob, filename);
    } catch (caught) {
      setError(formMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="actions" role="group" aria-label="Export">
      {FORMATS.map(([format, label]) => (
        <button
          key={format}
          type="button"
          className="secondary"
          disabled={busy !== null}
          onClick={() => void run(format)}
        >
          {busy === format ? 'Preparing…' : `Export ${label}`}
        </button>
      ))}
      {error ? (
        <p role="alert" className="form-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
