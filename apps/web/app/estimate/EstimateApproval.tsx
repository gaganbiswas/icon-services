'use client';

import { type CustomerEstimate, formatMoney } from '@icon/contracts';
import { useEffect, useRef, useState } from 'react';

import { PortalError, portalApi, tokenFromHash } from '../../lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; estimate: CustomerEstimate }
  | { kind: 'done'; estimate: CustomerEstimate };

const COVERAGE = {
  CUSTOMER_PAY: 'You pay',
  WARRANTY: 'Covered by warranty',
  GOODWILL: 'No charge (goodwill)',
} as const;

export function EstimateApproval({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  // Held in a ref: never rendered, never re-sent to the address bar.
  const tokenRef = useRef<string | null>(null);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [confirming, setConfirming] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const found = tokenFromHash(window.location.hash);
    // Remove the token from the address bar and history once read.
    window.history.replaceState(null, '', window.location.pathname);
    tokenRef.current = found;
    const load = found
      ? portalApi.viewEstimate(found, fetchImpl)
      : Promise.reject(
          new PortalError(
            'INVALID_TOKEN',
            'This link is incomplete. Please use the full link sent by the service centre.',
          ),
        );
    load.then(
      (estimate) => setState({ kind: 'ready', estimate }),
      (caught: unknown) =>
        setState({
          kind: 'invalid',
          message: caught instanceof PortalError ? caught.message : 'This link cannot be opened.',
        }),
    );
  }, [fetchImpl]);

  async function submit(decision: 'APPROVED' | 'REJECTED') {
    const token = tokenRef.current;
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const estimate = await portalApi.decide(
        token,
        {
          decision,
          termsAccepted: decision === 'APPROVED' && acceptTerms,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        },
        fetchImpl,
      );
      setState({ kind: 'done', estimate });
    } catch (caught) {
      setError(
        caught instanceof PortalError ? caught.message : 'Something went wrong. Please try again.',
      );
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'loading') {
    return (
      <main aria-busy="true">
        <p className="muted">Loading your estimate…</p>
      </main>
    );
  }
  if (state.kind === 'invalid') {
    return (
      <main>
        <h1>Repair estimate</h1>
        <p role="alert">{state.message}</p>
      </main>
    );
  }
  if (state.kind === 'done') {
    const approved = state.estimate.status === 'APPROVED';
    return (
      <main>
        <h1>{approved ? 'Thank you — estimate approved' : 'Estimate declined'}</h1>
        <p>
          {approved
            ? `We will continue with the repair of job ${state.estimate.jobNumber}.`
            : `We have recorded your decision for job ${state.estimate.jobNumber}. The service centre will contact you about returning your device.`}
        </p>
        <p className="muted">This link can no longer be used.</p>
      </main>
    );
  }

  const e = state.estimate;
  const m = (value: string) => formatMoney(value, e.currency);
  const open = e.status === 'SENT' && !e.expired;
  return (
    <main>
      <p className="muted">{e.businessName}</p>
      <h1>Repair estimate</h1>
      <p>
        Job <strong>{e.jobNumber}</strong> · {e.device} · version {e.version}
      </p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {e.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  {line.description}
                  <br />
                  <span className="muted small">{COVERAGE[line.coverage]}</span>
                </td>
                <td>{line.quantity.replace(/\.?0+$/, '')}</td>
                <td>{m(line.unitPrice)}</td>
                <td>
                  {m(line.lineTotal)}
                  {line.discount !== '0.0000' ? (
                    <span className="muted small"> (discount {m(line.discount)})</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="summary">
        <dt>Covered for you</dt>
        <dd>{m(e.covered)}</dd>
        <dt>Amount to approve</dt>
        <dd>
          <strong>{m(e.customerPayable)}</strong>
        </dd>
        <dt>Tax</dt>
        <dd>{e.taxNote}</dd>
        {e.validUntil ? (
          <>
            <dt>Valid until</dt>
            <dd>{e.validUntil}</dd>
          </>
        ) : null}
      </dl>
      {e.notes ? <p>{e.notes}</p> : null}
      <section aria-labelledby="terms-heading">
        <h2 id="terms-heading">Terms</h2>
        <p className="terms">{e.terms}</p>
      </section>
      {!open ? (
        <p role="status">
          {e.expired
            ? 'This estimate has expired. Please contact the service centre.'
            : 'This estimate is no longer open for a decision.'}
        </p>
      ) : confirming ? (
        <div role="alertdialog" aria-labelledby="confirm-heading" className="confirm">
          <h2 id="confirm-heading">
            {confirming === 'APPROVED'
              ? `Approve ${m(e.customerPayable)}?`
              : 'Decline this estimate?'}
          </h2>
          <p>This cannot be undone online.</p>
          <div className="actions">
            <button type="button" onClick={() => void submit(confirming)} disabled={busy}>
              {busy ? 'Sending…' : confirming === 'APPROVED' ? 'Yes, approve' : 'Yes, decline'}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setConfirming(null)}
              disabled={busy}
            >
              Go back
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={(event) => event.preventDefault()} aria-label="Your decision">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={acceptTerms}
              onChange={(ev) => setAcceptTerms(ev.target.checked)}
            />{' '}
            I have read and accept the terms
          </label>
          <label htmlFor="comment">Comment (optional)</label>
          <textarea
            id="comment"
            value={comment}
            onChange={(ev) => setComment(ev.target.value)}
            maxLength={1000}
          />
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
          <div className="actions">
            <button type="button" disabled={!acceptTerms} onClick={() => setConfirming('APPROVED')}>
              Approve estimate
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming('REJECTED')}>
              Decline
            </button>
          </div>
          {!acceptTerms ? (
            <p className="muted small">Tick the box to accept the terms before approving.</p>
          ) : null}
        </form>
      )}
    </main>
  );
}
