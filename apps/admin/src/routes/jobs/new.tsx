import {
  type Asset,
  type Branch,
  type CreateJobRequest,
  type Customer,
  DEFAULT_INTAKE_CHECKLIST,
  type JobDetail,
  type Page,
  type StoredFileInfo,
} from '@icon/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { CustomerForm } from '../../components/CustomerForm';
import { DeviceForm } from '../../components/DeviceForm';
import { FormField } from '../../components/FormField';
import { SelectField, TextAreaField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { newIdempotencyKey } from '../../lib/idempotency';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/jobs/new')({
  validateSearch: (search: Record<string, unknown>): { customerId?: string } =>
    typeof search['customerId'] === 'string' ? { customerId: search['customerId'] } : {},
  component: () => (
    <RequireAuth>
      <IntakeWizard />
    </RequireAuth>
  ),
});

type Step = 'customer' | 'device' | 'details' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'customer', label: '1. Customer' },
  { id: 'device', label: '2. Device' },
  { id: 'details', label: '3. Details' },
  { id: 'review', label: '4. Review' },
];

type Details = Omit<CreateJobRequest, 'customerId' | 'assetId'>;

export function IntakeWizard() {
  const { client } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [step, setStep] = useState<Step>('customer');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [device, setDevice] = useState<Asset | null>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [photos, setPhotos] = useState<StoredFileInfo[]>([]);
  // One key per intended job: retries after network failures reuse it.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  useEffect(() => {
    if (!search.customerId) return;
    let cancelled = false;
    client.get<Customer>(`/customers/${search.customerId}`).then(
      (c) => {
        if (!cancelled) {
          setCustomer(c);
          setStep('device');
        }
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [client, search.customerId]);

  return (
    <AppShell title="New job">
      <ol className="stepper" aria-label="Intake steps">
        {STEPS.map((s) => (
          <li key={s.id} aria-current={s.id === step ? 'step' : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      {step === 'customer' ? (
        <CustomerStep
          onSelect={(c) => {
            setCustomer(c);
            setDevice(null);
            setStep('device');
          }}
        />
      ) : null}
      {step === 'device' && customer ? (
        <DeviceStep
          customer={customer}
          onBack={() => setStep('customer')}
          onSelect={(d) => {
            setDevice(d);
            setStep('details');
          }}
        />
      ) : null}
      {step === 'details' && customer && device ? (
        <DetailsStep
          initial={details}
          photos={photos}
          onPhotos={setPhotos}
          onBack={() => setStep('device')}
          onNext={(d) => {
            setDetails(d);
            setIdempotencyKey(newIdempotencyKey());
            setStep('review');
          }}
        />
      ) : null}
      {step === 'review' && customer && device && details ? (
        <ReviewStep
          customer={customer}
          device={device}
          details={details}
          photos={photos}
          idempotencyKey={idempotencyKey}
          onBack={() => setStep('details')}
          onCreated={(job) => void navigate({ to: '/jobs/$jobId', params: { jobId: job.id } })}
        />
      ) : null}
    </AppShell>
  );
}

function CustomerStep({ onSelect }: { onSelect: (customer: Customer) => void }) {
  const { client } = useAuth();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const results = useResource(
    () =>
      q ? client.get<Page<Customer>>('/customers', { q, pageSize: 10 }) : Promise.resolve(null),
    [client, q],
  );

  if (creating) {
    return (
      <section aria-labelledby="new-customer-heading">
        <h2 id="new-customer-heading">New customer</h2>
        <CustomerForm submitLabel="Save and continue" onCreated={onSelect} />
        <button type="button" className="secondary" onClick={() => setCreating(false)}>
          Back to search
        </button>
      </section>
    );
  }

  return (
    <section aria-labelledby="find-customer-heading">
      <h2 id="find-customer-heading">Find the customer</h2>
      <form
        role="search"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          setQ(formText(new FormData(e.currentTarget), 'q').trim());
        }}
      >
        <FormField id="q" label="Name, mobile number or customer code" type="search" />
        <button type="submit">Search</button>
      </form>
      <ResourceView resource={results}>
        {(page) =>
          page === null ? null : page.items.length === 0 ? (
            <p className="muted">No matching customers.</p>
          ) : (
            <ul>
              {page.items.map((c) => (
                <li key={c.id}>
                  <button type="button" className="secondary" onClick={() => onSelect(c)}>
                    Select
                  </button>{' '}
                  {c.name} · {c.phone} <span className="muted small">({c.customerCode})</span>
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>
      <p>
        <button type="button" onClick={() => setCreating(true)}>
          New customer
        </button>
      </p>
    </section>
  );
}

function DeviceStep({
  customer,
  onSelect,
  onBack,
}: {
  customer: Customer;
  onSelect: (device: Asset) => void;
  onBack: () => void;
}) {
  const { client } = useAuth();
  const devices = useResource(
    () => client.get<Asset[]>(`/customers/${customer.id}/assets`),
    [client, customer.id],
  );
  const [warning, setWarning] = useState<string | null>(null);
  const [pending, setPending] = useState<Asset | null>(null);

  return (
    <section aria-labelledby="device-heading">
      <h2 id="device-heading">Device for {customer.name}</h2>
      <ResourceView resource={devices}>
        {(list) =>
          list.length === 0 ? (
            <p className="muted">This customer has no devices yet. Add one below.</p>
          ) : (
            <ul>
              {list.map((d) => (
                <li key={d.id}>
                  <button type="button" className="secondary" onClick={() => onSelect(d)}>
                    Select
                  </button>{' '}
                  {d.category.name}: {d.brand} {d.model}
                  {d.serialNumber ? ` · S/N ${d.serialNumber}` : ''}
                </li>
              ))}
            </ul>
          )
        }
      </ResourceView>
      {warning && pending ? (
        <div className="warning" role="status">
          <p>{warning}</p>
          <button type="button" onClick={() => onSelect(pending)}>
            Continue with this device
          </button>
        </div>
      ) : null}
      <details open={devices.status === 'ready' && devices.data.length === 0}>
        <summary>Add a new device</summary>
        <DeviceForm
          customerId={customer.id}
          onCreated={(result) => {
            if (result.duplicateSerialWarning) {
              setPending(result.asset);
              setWarning(
                `This serial number already exists on ${result.duplicateSerialWarning.count} other device record(s). Check it is not a duplicate.`,
              );
            } else {
              onSelect(result.asset);
            }
          }}
        />
      </details>
      <button type="button" className="secondary" onClick={onBack}>
        Back
      </button>
    </section>
  );
}

function DetailsStep({
  initial,
  photos,
  onPhotos,
  onNext,
  onBack,
}: {
  initial: Details | null;
  photos: StoredFileInfo[];
  onPhotos: (photos: StoredFileInfo[]) => void;
  onNext: (details: Details) => void;
  onBack: () => void;
}) {
  const { client } = useAuth();
  const branches = useResource(() => client.get<Branch[]>('/branches'), [client]);
  const [mode, setMode] = useState(initial?.serviceMode ?? 'AT_SERVICE_CENTRE');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function onFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setUploadError(null);
    const uploaded: StoredFileInfo[] = [];
    try {
      for (const file of Array.from(files)) {
        uploaded.push(await client.upload<StoredFileInfo>('/files', file, file.name));
      }
    } catch (caught) {
      setUploadError(formMessage(caught));
    } finally {
      onPhotos([...photos, ...uploaded]);
      setUploading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const complaint = formText(form, 'complaint').trim();
    const next: Record<string, string> = {};
    if (complaint.length < 5) next['complaint'] = 'Describe the problem (at least 5 characters)';
    if (
      mode === 'ON_SITE' &&
      (!formText(form, 'siteLine1') ||
        !formText(form, 'siteCity') ||
        !formText(form, 'siteCountry'))
    ) {
      next['siteLine1'] = 'Enter the on-site address';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const expected = formText(form, 'expectedCompletionDate');
    const ack = formText(form, 'acknowledgementMethod');
    onNext({
      branchId: formText(form, 'branchId'),
      serviceType: formText(form, 'serviceType') as Details['serviceType'],
      serviceMode: mode,
      complaint,
      accessoriesReceived: formText(form, 'accessories')
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      intakeChecklist: DEFAULT_INTAKE_CHECKLIST.map((item, i) => ({
        item,
        checked: form.get(`check${i}`) !== null,
      })),
      ...(formText(form, 'conditionNotes').trim()
        ? { conditionNotes: formText(form, 'conditionNotes').trim() }
        : {}),
      ...(expected ? { expectedCompletionDate: expected } : {}),
      ...(ack === 'SIGNED_PAPER' || ack === 'VERBAL' ? { acknowledgementMethod: ack } : {}),
      ...(mode === 'ON_SITE'
        ? {
            serviceAddress: {
              line1: formText(form, 'siteLine1'),
              city: formText(form, 'siteCity'),
              countryCode: formText(form, 'siteCountry').toUpperCase(),
            },
          }
        : {}),
      attachmentFileIds: photos.map((p) => p.id),
    });
  }

  return (
    <ResourceView resource={branches}>
      {(list) => (
        <form onSubmit={onSubmit} noValidate aria-label="Job details">
          <div className="grid-2">
            <SelectField
              id="branchId"
              label="Branch"
              defaultValue={initial?.branchId ?? list[0]?.id}
            >
              {list.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </SelectField>
            <SelectField
              id="serviceType"
              label="Service coverage"
              defaultValue={initial?.serviceType ?? 'WARRANTY_UNVERIFIED'}
            >
              <option value="WARRANTY_UNVERIFIED">Warranty not yet verified</option>
              <option value="IN_WARRANTY">In warranty (verified)</option>
              <option value="OUT_OF_WARRANTY">Out of warranty</option>
            </SelectField>
            <SelectField
              id="serviceMode"
              label="Service mode"
              value={mode}
              onChange={(e) =>
                setMode(e.target.value === 'ON_SITE' ? 'ON_SITE' : 'AT_SERVICE_CENTRE')
              }
            >
              <option value="AT_SERVICE_CENTRE">At service centre</option>
              <option value="ON_SITE">On-site</option>
            </SelectField>
            <FormField
              id="expectedCompletionDate"
              label="Expected completion (optional)"
              type="date"
              defaultValue={initial?.expectedCompletionDate}
            />
          </div>
          <TextAreaField
            id="complaint"
            label="Complaint (customer's own words)"
            required
            defaultValue={initial?.complaint}
            error={errors['complaint']}
          />
          <FormField
            id="accessories"
            label="Accessories received (comma separated)"
            defaultValue={initial?.accessoriesReceived.join(', ')}
            placeholder="Charger, bag"
          />
          <TextAreaField
            id="conditionNotes"
            label="Visible condition (scratches, damage…)"
            defaultValue={initial?.conditionNotes}
          />
          <fieldset>
            <legend>Intake checklist</legend>
            {DEFAULT_INTAKE_CHECKLIST.map((item, i) => (
              <label key={item} className="checkbox">
                <input
                  type="checkbox"
                  name={`check${i}`}
                  defaultChecked={initial?.intakeChecklist[i]?.checked ?? false}
                />{' '}
                {item}
              </label>
            ))}
          </fieldset>
          {mode === 'ON_SITE' ? (
            <fieldset>
              <legend>On-site address</legend>
              <div className="grid-2">
                <FormField id="siteLine1" label="Address line" error={errors['siteLine1']} />
                <FormField id="siteCity" label="City" />
                <FormField id="siteCountry" label="Country code (2 letters)" maxLength={2} />
              </div>
            </fieldset>
          ) : null}
          <div className="field">
            <label htmlFor="photos">
              Intake photos (JPEG, PNG, WebP, HEIC or PDF, up to 10 MB each)
            </label>
            <input
              id="photos"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
              multiple
              onChange={(e) => void onFiles(e.target.files)}
            />
            {uploading ? <p className="muted">Uploading…</p> : null}
            {uploadError ? (
              <p role="alert" className="form-error">
                {uploadError}
              </p>
            ) : null}
            {photos.length ? (
              <p className="small">Attached: {photos.map((p) => p.originalName).join(', ')}</p>
            ) : null}
          </div>
          <SelectField
            id="acknowledgementMethod"
            label="Customer acknowledgement"
            defaultValue={initial?.acknowledgementMethod ?? 'SIGNED_PAPER'}
          >
            <option value="SIGNED_PAPER">Signed printed receipt</option>
            <option value="VERBAL">Verbal confirmation</option>
          </SelectField>
          <div className="actions">
            <button type="button" className="secondary" onClick={onBack}>
              Back
            </button>
            <button type="submit" disabled={uploading}>
              Review
            </button>
          </div>
        </form>
      )}
    </ResourceView>
  );
}

function ReviewStep({
  customer,
  device,
  details,
  photos,
  idempotencyKey,
  onBack,
  onCreated,
}: {
  customer: Customer;
  device: Asset;
  details: Details;
  photos: StoredFileInfo[];
  idempotencyKey: string;
  onBack: () => void;
  onCreated: (job: JobDetail) => void;
}) {
  const { client } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function submit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const job = await client.post<JobDetail>(
        '/jobs',
        { ...details, customerId: customer.id, assetId: device.id } satisfies CreateJobRequest,
        { 'Idempotency-Key': idempotencyKey },
      );
      onCreated(job);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Review and register</h2>
      <dl className="summary">
        <dt>Customer</dt>
        <dd>
          {customer.name} · {customer.phone}
        </dd>
        <dt>Device</dt>
        <dd>
          {device.category.name}: {device.brand} {device.model}
          {device.serialNumber ? ` · S/N ${device.serialNumber}` : ''}
        </dd>
        <dt>Complaint</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{details.complaint}</dd>
        <dt>Accessories</dt>
        <dd>{details.accessoriesReceived.join(', ') || 'None'}</dd>
        <dt>Photos</dt>
        <dd>{photos.length}</dd>
      </dl>
      {message ? (
        <div role="alert">
          <p className="form-error">{message}</p>
          {Object.entries(errors).map(([path, text]) => (
            <p key={path} className="field-error">
              {path}: {text}
            </p>
          ))}
          <p className="small muted">
            Retrying is safe: the same request will not create a second job.
          </p>
        </div>
      ) : null}
      <div className="actions">
        <button type="button" className="secondary" onClick={onBack} disabled={submitting}>
          Back
        </button>
        <button type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Registering…' : 'Register job'}
        </button>
      </div>
    </section>
  );
}
