'use client';

import {
  type CustomerEstimate,
  type CustomerInvoice,
  type CustomerJob,
  type CustomerPayment,
  type DocumentLink,
  formatMoney,
} from '@icon/contracts';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';

import { PortalError } from '../../lib/api';
import { CustomerClient } from '../../lib/customer';

const message = (e: unknown) =>
  e instanceof PortalError ? e.message : 'Something went wrong. Please try again.';

type View =
  { kind: 'checking' } | { kind: 'signed-out' } | { kind: 'jobs' } | { kind: 'job'; id: string };

export function CustomerPortal({ client: given }: { client?: CustomerClient }) {
  const client = useMemo(() => given ?? new CustomerClient(), [given]);
  const [view, setView] = useState<View>({ kind: 'checking' });

  useEffect(() => {
    void client.restore().then((ok) => setView(ok ? { kind: 'jobs' } : { kind: 'signed-out' }));
  }, [client]);

  async function signOut() {
    await client.signOut().catch(() => undefined);
    setView({ kind: 'signed-out' });
  }

  if (view.kind === 'checking') {
    return (
      <main aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  if (view.kind === 'signed-out') {
    return <SignIn client={client} onSignedIn={() => setView({ kind: 'jobs' })} />;
  }
  return (
    <main>
      <div className="actions spread">
        <p className="muted">ICON INFOSYS — my service requests</p>
        <button type="button" className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      {view.kind === 'jobs' ? (
        <JobList client={client} onOpen={(id) => setView({ kind: 'job', id })} />
      ) : (
        <JobDetail client={client} id={view.id} onBack={() => setView({ kind: 'jobs' })} />
      )}
    </main>
  );
}

function SignIn({ client, onSignedIn }: { client: CustomerClient; onSignedIn: () => void }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [needsName, setNeedsName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'phone') {
        await client.requestCode(phone);
        setStep('code');
      } else {
        await client.verify(phone, code, needsName ? name : undefined);
        onSignedIn();
      }
    } catch (caught) {
      if (caught instanceof PortalError && caught.code === 'PROFILE_REQUIRED') {
        setNeedsName(true);
        setError('Welcome! Please tell us your name to finish signing in.');
      } else {
        setError(message(caught));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <p>Track your repairs, approve estimates and download invoices and receipts.</p>
      <form onSubmit={(e) => void submit(e)} aria-label="Sign in">
        <label htmlFor="phone">Mobile number</label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={step === 'code'}
          required
        />
        {step === 'code' ? (
          <>
            <label htmlFor="code">6-digit code sent to you on WhatsApp</label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            {needsName ? (
              <>
                <label htmlFor="name">Your name</label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </>
            ) : null}
          </>
        ) : null}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Please wait…' : step === 'phone' ? 'Send code' : 'Sign in'}
          </button>
          {step === 'code' ? (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setStep('phone');
                setCode('');
                setNeedsName(false);
              }}
            >
              Change number
            </button>
          ) : null}
        </div>
      </form>
    </main>
  );
}

function useData<T>(load: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  const reload = useCallback(() => {
    load().then(
      (data) => setState({ data }),
      (e: unknown) => setState({ error: message(e) }),
    );
  }, [load]);
  useEffect(reload, [reload]);
  return { ...state, reload };
}

function JobList({ client, onOpen }: { client: CustomerClient; onOpen: (id: string) => void }) {
  const jobs = useData(useCallback(() => client.jobs(), [client]));
  return (
    <>
      <h1>My service requests</h1>
      {jobs.error ? <p role="alert">{jobs.error}</p> : null}
      {!jobs.data && !jobs.error ? <p className="muted">Loading…</p> : null}
      {jobs.data?.length === 0 ? (
        <p>
          You have no service requests yet. Contact the service centre or use the app to raise one.
        </p>
      ) : null}
      {jobs.data && jobs.data.length > 0 ? (
        <ul className="cards">
          {jobs.data.map((j) => (
            <li key={j.id}>
              <button type="button" className="card" onClick={() => onOpen(j.id)}>
                <strong>{j.jobNumber}</strong>
                <span>
                  {j.device.category}: {j.device.brand} {j.device.model}
                </span>
                <span className="status">Status: {j.statusLabel}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Fetches a short-lived signed link, then shows it as a normal link (avoids pop-up blockers). */
function DocumentButton({ label, get }: { label: string; get: () => Promise<DocumentLink> }) {
  const [link, setLink] = useState<DocumentLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (link) {
    return (
      <a href={link.url} target="_blank" rel="noopener noreferrer">
        Open {link.documentNumber} (PDF, link expires shortly)
      </a>
    );
  }
  return (
    <span>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          get()
            .then(setLink, (e: unknown) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Preparing…' : label}
      </button>
      {error ? (
        <span role="alert" className="error">
          {' '}
          {error}
        </span>
      ) : null}
    </span>
  );
}

function JobDetail({
  client,
  id,
  onBack,
}: {
  client: CustomerClient;
  id: string;
  onBack: () => void;
}) {
  const data = useData(
    useCallback(
      () =>
        Promise.all([
          client.job(id),
          client.estimates(id),
          client.invoices(),
          client.payments(),
        ]) as Promise<[CustomerJob, CustomerEstimate[], CustomerInvoice[], CustomerPayment[]]>,
      [client, id],
    ),
  );
  if (data.error) return <p role="alert">{data.error}</p>;
  if (!data.data) return <p className="muted">Loading…</p>;
  const [job, estimates, allInvoices, allPayments] = data.data;
  const invoices = allInvoices.filter((i) => i.jobNumber === job.jobNumber);
  const payments = allPayments.filter((p) => p.jobNumber === job.jobNumber);
  const current = estimates[0];
  return (
    <>
      <button type="button" className="secondary" onClick={onBack}>
        ← All requests
      </button>
      <h1>Job {job.jobNumber}</h1>
      <dl className="summary">
        <dt>Status</dt>
        <dd>{job.statusLabel}</dd>
        <dt>Device</dt>
        <dd>
          {job.device.category}: {job.device.brand} {job.device.model}
          {job.device.serialNumber ? ` (S/N ${job.device.serialNumber})` : ''}
        </dd>
        <dt>Service centre</dt>
        <dd>{job.branch.name}</dd>
        <dt>Your complaint</dt>
        <dd>{job.complaint}</dd>
      </dl>
      <p>
        <DocumentButton label="Job receipt (PDF)" get={() => client.jobReceipt(job.id)} />
      </p>
      {current ? (
        <EstimateSection client={client} estimate={current} onDecided={data.reload} />
      ) : null}
      <section aria-labelledby="progress-heading">
        <h2 id="progress-heading">Progress</h2>
        <ol className="timeline">
          {job.timeline.map((t) => (
            <li key={t.at + t.status}>
              <time dateTime={t.at}>{new Date(t.at).toLocaleString()}</time> — {t.label}
              {t.message ? `: ${t.message}` : ''}
            </li>
          ))}
        </ol>
      </section>
      {invoices.length > 0 ? (
        <section aria-labelledby="invoices-heading">
          <h2 id="invoices-heading">Tax invoices</h2>
          <ul className="plain">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <p>
                  <strong>{inv.invoiceNumber}</strong> ({inv.invoiceDate}):{' '}
                  {formatMoney(inv.total, inv.currency)}
                  {inv.status === 'CANCELLED'
                    ? ' — cancelled'
                    : inv.balance !== '0.00'
                      ? ` — due ${formatMoney(inv.balance, inv.currency)}`
                      : ' — paid'}
                </p>
                <div className="actions">
                  <DocumentButton
                    label={`Invoice ${inv.invoiceNumber} (PDF)`}
                    get={() => client.invoicePdf(inv.id)}
                  />
                  {inv.creditNotes.map((c) => (
                    <DocumentButton
                      key={c.id}
                      label={`Credit note ${c.number} (PDF)`}
                      get={() => client.creditNotePdf(c.id)}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {payments.length > 0 ? (
        <section aria-labelledby="payments-heading">
          <h2 id="payments-heading">Payments</h2>
          <ul className="plain">
            {payments.map((p) => (
              <li key={p.id}>
                <p>
                  {p.receiptNumber}: {formatMoney(p.amount, p.currency)}
                  {p.status === 'REVERSED' ? ' (reversed)' : ''}
                </p>
                <DocumentButton
                  label={`Receipt ${p.receiptNumber} (PDF)`}
                  get={() => client.paymentReceipt(p.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function EstimateSection({
  client,
  estimate: e,
  onDecided,
}: {
  client: CustomerClient;
  estimate: CustomerEstimate;
  onDecided: () => void;
}) {
  const [accept, setAccept] = useState(false);
  const [confirming, setConfirming] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const m = (v: string) => formatMoney(v, e.currency);
  const open = e.status === 'SENT' && !e.expired;

  async function decide(decision: 'APPROVED' | 'REJECTED') {
    setBusy(true);
    setError(null);
    try {
      await client.decide(e.id, decision, decision === 'APPROVED' && accept);
      onDecided();
    } catch (caught) {
      setError(message(caught));
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="estimate-heading">
      <h2 id="estimate-heading">Estimate (version {e.version})</h2>
      <ul className="plain">
        {e.lines.map((l) => (
          <li key={l.id}>
            {l.description} — {m(l.lineTotal)}
            {l.coverage !== 'CUSTOMER_PAY' ? (
              <span className="muted small"> (no charge to you)</span>
            ) : null}
          </li>
        ))}
      </ul>
      <p>
        Amount to approve: <strong>{m(e.customerPayable)}</strong> · {e.taxNote}
      </p>
      {e.status === 'APPROVED' ? <p role="status">You approved this estimate.</p> : null}
      {e.status === 'REJECTED' ? <p role="status">You declined this estimate.</p> : null}
      {e.status === 'SENT' && e.expired ? (
        <p role="status">This estimate has expired. Please contact the service centre.</p>
      ) : null}
      {open ? (
        <>
          <details>
            <summary>Terms</summary>
            <p className="terms">{e.terms}</p>
          </details>
          {confirming ? (
            <div role="alertdialog" aria-labelledby="confirm-estimate" className="confirm">
              <h3 id="confirm-estimate">
                {confirming === 'APPROVED'
                  ? `Approve ${m(e.customerPayable)}?`
                  : 'Decline this estimate?'}
              </h3>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => void decide(confirming)}>
                  {busy ? 'Sending…' : confirming === 'APPROVED' ? 'Yes, approve' : 'Yes, decline'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirming(null)}
                >
                  Go back
                </button>
              </div>
            </div>
          ) : (
            <div className="actions">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={accept}
                  onChange={(ev) => setAccept(ev.target.checked)}
                />{' '}
                I have read and accept the terms
              </label>
              <button type="button" disabled={!accept} onClick={() => setConfirming('APPROVED')}>
                Approve estimate
              </button>
              <button type="button" className="secondary" onClick={() => setConfirming('REJECTED')}>
                Decline
              </button>
            </div>
          )}
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
