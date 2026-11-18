import { type CustomerEstimate, formatMoney } from '@icon/contracts';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { errorMessage } from '../api/client';
import { Body, Button, ErrorText, Title, usePalette } from '../components/ui';
import { useSession } from '../session';

/** Current estimate with approve / decline (terms acceptance + confirmation). */
export function EstimateCard({
  estimate,
  onDecided,
}: {
  estimate: CustomerEstimate;
  onDecided: () => void;
}) {
  const { api } = useSession();
  const p = usePalette();
  const [accepted, setAccepted] = useState(false);
  const [confirming, setConfirming] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = (v: string) => formatMoney(v, estimate.currency);
  const open = estimate.status === 'SENT' && !estimate.expired;

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    try {
      await api.decideEstimate(estimate.id, decision, decision === 'APPROVED' && accepted);
      onDecided();
    } catch (caught) {
      setError(errorMessage(caught));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 8, borderWidth: 1, borderColor: p.border, borderRadius: 10, padding: 12 }}>
      <Title>Estimate (version {estimate.version})</Title>
      {estimate.lines.map((line) => (
        <Body key={line.id}>
          {line.description}: {m(line.lineTotal)}
          {line.coverage !== 'CUSTOMER_PAY' ? ' (covered)' : ''}
        </Body>
      ))}
      <Body>Amount to approve: {m(estimate.customerPayable)}</Body>
      <Body muted>{estimate.taxNote}</Body>
      {estimate.validUntil ? <Body muted>Valid until {estimate.validUntil}</Body> : null}
      <Body muted>{estimate.terms}</Body>
      {!open ? (
        <Body>
          {estimate.status === 'APPROVED'
            ? 'You approved this estimate.'
            : estimate.status === 'REJECTED'
              ? 'You declined this estimate.'
              : estimate.expired
                ? 'This estimate has expired. Please contact the service centre.'
                : 'This estimate is no longer open.'}
        </Body>
      ) : confirming ? (
        <>
          <Body>
            {confirming === 'APPROVED'
              ? `Approve ${m(estimate.customerPayable)}?`
              : 'Decline this estimate?'}
          </Body>
          <Button
            label={confirming === 'APPROVED' ? 'Yes, approve' : 'Yes, decline'}
            onPress={() => void decide(confirming)}
            busy={busy}
          />
          <Button
            label="Go back"
            variant="secondary"
            onPress={() => setConfirming(null)}
            disabled={busy}
          />
        </>
      ) : (
        <>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="I have read and accept the terms"
            accessibilityState={{ checked: accepted }}
            onPress={() => setAccepted((v) => !v)}
            style={{ minHeight: 48, justifyContent: 'center' }}
          >
            <Text style={{ color: p.text }}>
              {accepted ? '☑' : '☐'} I have read and accept the terms
            </Text>
          </Pressable>
          <Button
            label="Approve estimate"
            onPress={() => setConfirming('APPROVED')}
            disabled={!accepted}
          />
          <Button label="Decline" variant="secondary" onPress={() => setConfirming('REJECTED')} />
        </>
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
