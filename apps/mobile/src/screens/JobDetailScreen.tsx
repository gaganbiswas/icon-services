import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';

import { type CustomerApi, errorMessage } from '../api/client';
import { Body, Button, ErrorText, Screen, Title } from '../components/ui';
import { useSession } from '../session';
import { useLoad } from '../use-load';
import { EstimateCard } from './EstimateCard';

/** Downloads the receipt PDF to the cache and opens the share sheet. */
export async function shareReceipt(api: CustomerApi, jobId: string): Promise<void> {
  const link = await api.receipt(jobId);
  const target = new File(
    Paths.cache,
    `receipt-${link.documentNumber.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`,
  );
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(link.url, target);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Job receipt' });
}

export function JobDetailScreen({
  id,
  share = shareReceipt,
}: {
  id: string;
  share?: typeof shareReceipt;
}) {
  const { api } = useSession();
  const [job, reload] = useLoad(() => Promise.all([api.job(id), api.estimates(id)]), [api, id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onShare() {
    setBusy(true);
    setError(null);
    try {
      await share(api, id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (job.status === 'loading')
    return (
      <Screen>
        <Body muted>Loading…</Body>
      </Screen>
    );
  if (job.status === 'error')
    return (
      <Screen>
        <ErrorText>{job.message}</ErrorText>
        <Button label="Try again" variant="secondary" onPress={reload} />
      </Screen>
    );
  const [j, estimates] = job.data;
  const current = estimates.find((e) => e.status !== 'SUPERSEDED');
  return (
    <Screen>
      <Title>{j.jobNumber}</Title>
      <Body>Status: {j.statusLabel}</Body>
      <Body>
        {j.device.category}: {j.device.brand} {j.device.model}
      </Body>
      <Body muted>Branch: {j.branch.name}</Body>
      <Body>Problem: {j.complaint}</Body>
      {j.updates.length > 0 ? (
        <>
          <Title>Updates from the service centre</Title>
          {j.updates.map((u) => (
            <Body key={u.at}>
              {new Date(u.at).toLocaleString()} — {u.message}
            </Body>
          ))}
        </>
      ) : null}
      {current ? <EstimateCard estimate={current} onDecided={reload} /> : null}
      <Title>Progress</Title>
      {j.timeline.map((t) => (
        <Body key={t.at + t.status}>
          {new Date(t.at).toLocaleString()} — {t.label}
          {t.message ? `: ${t.message}` : ''}
        </Body>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label="Download / share receipt" onPress={() => void onShare()} busy={busy} />
    </Screen>
  );
}
