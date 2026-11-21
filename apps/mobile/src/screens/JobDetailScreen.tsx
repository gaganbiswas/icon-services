import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatMoney } from '@icon/contracts';
import { useState } from 'react';
import { View } from 'react-native';

import { type CustomerApi, errorMessage } from '../api/client';
import { Body, Button, ErrorText, Screen, Title } from '../components/ui';
import { useSession } from '../session';
import { useLoad } from '../use-load';
import { EstimateCard } from './EstimateCard';

/** Downloads a PDF to the cache and opens the share sheet. */
async function sharePdf(
  link: { url: string; documentNumber: string },
  title: string,
): Promise<void> {
  const target = new File(
    Paths.cache,
    `${title.replace(/\s+/g, '-').toLowerCase()}-${link.documentNumber.replace(/[^A-Za-z0-9-]/g, '_')}.pdf`,
  );
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(link.url, target);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: title });
}

export async function sharePaymentReceipt(api: CustomerApi, paymentId: string): Promise<void> {
  await sharePdf(await api.paymentReceipt(paymentId), 'Payment receipt');
}

/** Downloads the job receipt PDF to the cache and opens the share sheet. */
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
  const [job, reload] = useLoad(
    () => Promise.all([api.job(id), api.estimates(id), api.payments(), api.invoices()]),
    [api, id],
  );
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
  const [j, estimates, allPayments, allInvoices] = job.data;
  const invoices = allInvoices.filter((i) => i.jobNumber === j.jobNumber);
  const payments = allPayments.filter((p) => p.jobNumber === j.jobNumber);
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
      {invoices.length > 0 ? <Title>Invoices</Title> : null}
      {invoices.map((inv) => (
        <View key={inv.id} style={{ gap: 4 }}>
          <Body>
            {inv.invoiceNumber} ({inv.invoiceDate}): {formatMoney(inv.total, inv.currency)}
            {inv.documentType === 'BILL_OF_SUPPLY' ? ' — bill of supply (no GST)' : ''}
            {inv.status === 'CANCELLED'
              ? ' — cancelled'
              : inv.balance !== '0.00'
                ? ` — due ${formatMoney(inv.balance, inv.currency)}`
                : ' — paid'}
          </Body>
          <Button
            label={`Share ${inv.documentType === 'BILL_OF_SUPPLY' ? 'bill of supply' : 'invoice'} ${inv.invoiceNumber}`}
            variant="secondary"
            onPress={() =>
              void api
                .invoicePdf(inv.id)
                .then((link) =>
                  sharePdf(
                    link,
                    inv.documentType === 'BILL_OF_SUPPLY' ? 'Bill of supply' : 'Tax invoice',
                  ),
                )
                .catch((e: unknown) => setError(errorMessage(e)))
            }
          />
          {inv.creditNotes.map((c) => (
            <Button
              key={c.id}
              label={`Share credit note ${c.number}`}
              variant="secondary"
              onPress={() =>
                void api
                  .creditNotePdf(c.id)
                  .then((link) => sharePdf(link, 'Credit note'))
                  .catch((e: unknown) => setError(errorMessage(e)))
              }
            />
          ))}
        </View>
      ))}
      {payments.length > 0 ? <Title>Payments</Title> : null}
      {payments.map((p) => (
        <View key={p.id} style={{ gap: 4 }}>
          <Body>
            {p.receiptNumber}: {formatMoney(p.amount, p.currency)}
            {p.status === 'REVERSED' ? ' (reversed)' : ''}
          </Body>
          <Button
            label={`Share receipt ${p.receiptNumber}`}
            variant="secondary"
            onPress={() =>
              void sharePaymentReceipt(api, p.id).catch((e: unknown) => setError(errorMessage(e)))
            }
          />
        </View>
      ))}
      <ErrorText>{error}</ErrorText>
      <Button label="Download / share receipt" onPress={() => void onShare()} busy={busy} />
    </Screen>
  );
}
