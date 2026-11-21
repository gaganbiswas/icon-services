import {
  type BusinessProfile,
  ESTIMATE_LINE_TYPES_FOR_TAX,
  INDIAN_STATES,
  type InvoicingSettings,
  type NumberFormat,
  type TaxSettings,
  isValidGstin,
} from '@icon/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { FormField } from '../../components/FormField';
import { SelectField, TextAreaField } from '../../components/Inputs';
import { RequireAuth } from '../../components/RequireAuth';
import { SettingsNav } from '../../components/SettingsNav';
import { ResourceView } from '../../components/ResourceView';
import { useAuth } from '../../lib/auth';
import { fieldErrors, formMessage, formText } from '../../lib/form-errors';
import { useCan } from '../../lib/permissions';
import { useResource } from '../../lib/use-resource';

export const Route = createFileRoute('/settings/invoicing')({
  component: () => (
    <RequireAuth>
      <AppShell title="Settings">
        <SettingsNav />
        <InvoicingSettingsPage />
      </AppShell>
    </RequireAuth>
  ),
});

interface AllSettings {
  business: BusinessProfile | null;
  tax: TaxSettings;
  invoicing: InvoicingSettings;
  money: { currency: string | null };
  'numbering.invoiceNumber': NumberFormat;
  'numbering.creditNoteNumber': NumberFormat;
  'numbering.billOfSupplyNumber': NumberFormat;
}

const LINE_TYPE_LABELS = {
  LABOUR: 'Labour',
  PART: 'Parts',
  SERVICE_FEE: 'Service fees',
  OTHER: 'Other charges',
} as const;
const list = (v: string) =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Saves one setting with an audited reason; shows the outcome. */
function SettingForm({
  label,
  children,
  build,
  onSaved,
  canManage,
}: {
  label: string;
  children: ReactNode;
  build: (form: FormData) => { key: string; value: unknown }[];
  onSaved: () => void;
  canManage: boolean;
}) {
  const { client } = useAuth();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setMessage(null);
    setErrors({});
    try {
      const reason = formText(form, 'reason').trim();
      if (!reason)
        throw new Error('Give a reason for the change (it is recorded in the audit log).');
      for (const item of build(form)) {
        await client.put(`/settings/${item.key}`, { value: item.value, reason });
      }
      setMessage({ ok: true, text: 'Saved.' });
      onSaved();
    } catch (caught) {
      setErrors(
        Object.fromEntries(
          Object.entries(fieldErrors(caught)).map(([k, v]) => [k.replace(/^value\./, ''), v]),
        ),
      );
      setMessage({
        ok: false,
        text:
          caught instanceof Error && !('status' in caught) ? caught.message : formMessage(caught),
      });
    }
  }
  return (
    <form className="card" onSubmit={(e) => void submit(e)} noValidate aria-label={label}>
      <h2>{label}</h2>
      <fieldset disabled={!canManage} className="plain">
        {children}
      </fieldset>
      {Object.keys(errors).length > 0 ? (
        <ul className="form-error">
          {Object.entries(errors).map(([k, v]) => (
            <li key={k}>
              {k}: {v}
            </li>
          ))}
        </ul>
      ) : null}
      {canManage ? (
        <>
          <FormField id={`${label}-reason`} name="reason" label="Reason for the change (audited)" />
          {message ? (
            <p role={message.ok ? 'status' : 'alert'} className={message.ok ? '' : 'form-error'}>
              {message.text}
            </p>
          ) : null}
          <button type="submit">Save</button>
        </>
      ) : null}
    </form>
  );
}

export function InvoicingSettingsPage() {
  const { client } = useAuth();
  const canManage = useCan('settings.manage');
  const [revision, setRevision] = useState(0);
  const data = useResource(() => client.get<AllSettings>('/settings'), [client, revision]);
  const saved = () => setRevision((n) => n + 1);
  return (
    <ResourceView resource={data}>
      {(s) => (
        <>
          <p className="muted small">
            These values print on every tax invoice. Tax rates and HSN/SAC codes must be checked by
            your accountant before you approve them; invoices cannot be issued until the tax
            configuration is approved.
          </p>
          <BusinessForm
            key={`b${revision}`}
            business={s.business}
            canManage={canManage}
            onSaved={saved}
          />
          <TaxForm
            key={`t${revision}`}
            tax={s.tax}
            currency={s.money.currency}
            canManage={canManage}
            onSaved={saved}
          />
          <SettingForm
            key={`i${revision}`}
            label="Invoice wording and numbers"
            canManage={canManage}
            onSaved={saved}
            build={(f) => [
              {
                key: 'invoicing',
                value: {
                  financialYearStartMonth: Number(formText(f, 'fyStart')),
                  terms: formText(f, 'terms').trim(),
                  declaration: formText(f, 'declaration').trim() || null,
                },
              },
              {
                key: 'numbering.invoiceNumber',
                value: { template: formText(f, 'invoiceTemplate').trim(), reset: 'FINANCIAL_YEAR' },
              },
              {
                key: 'numbering.billOfSupplyNumber',
                value: { template: formText(f, 'bosTemplate').trim(), reset: 'FINANCIAL_YEAR' },
              },
              {
                key: 'numbering.creditNoteNumber',
                value: { template: formText(f, 'creditTemplate').trim(), reset: 'FINANCIAL_YEAR' },
              },
            ]}
          >
            <SelectField
              id="fyStart"
              label="Financial year starts in"
              defaultValue={String(s.invoicing.financialYearStartMonth)}
            >
              {[
                'January',
                'February',
                'March',
                'April',
                'May',
                'June',
                'July',
                'August',
                'September',
                'October',
                'November',
                'December',
              ].map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </SelectField>
            <TextAreaField
              id="terms"
              label="Terms printed on invoices"
              defaultValue={s.invoicing.terms}
            />
            <FormField
              id="declaration"
              label="Declaration above the signature (optional)"
              defaultValue={s.invoicing.declaration ?? ''}
            />
            <div className="grid-2">
              <FormField
                id="invoiceTemplate"
                label="Tax invoice number format"
                defaultValue={s['numbering.invoiceNumber'].template}
                aria-describedby="numbering-hint"
              />
              <FormField
                id="bosTemplate"
                label="Bill of supply number format"
                defaultValue={s['numbering.billOfSupplyNumber'].template}
                aria-describedby="numbering-hint"
              />
              <FormField
                id="creditTemplate"
                label="Credit note number format"
                defaultValue={s['numbering.creditNoteNumber'].template}
              />
            </div>
            <p id="numbering-hint" className="muted small">
              Tokens: {'{FYS}'} = 2627, {'{FY}'} = 2026-27, {'{SEQ:1}'} = 1, {'{SEQ:6}'} = 000001.
              Example: MT/{'{FYS}'}/{'{SEQ:1}'} gives MT/2627/1. Numbers may have at most 16
              characters and restart each financial year, so keep the year in the format.
            </p>
          </SettingForm>
        </>
      )}
    </ResourceView>
  );
}

function BusinessForm({
  business,
  canManage,
  onSaved,
}: {
  business: BusinessProfile | null;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [gstin, setGstin] = useState(business?.gstin ?? '');
  const gstinProblem =
    gstin && !isValidGstin(gstin) ? 'Not a valid GSTIN (format or check digit).' : undefined;
  return (
    <SettingForm
      label="Business profile"
      canManage={canManage}
      onSaved={onSaved}
      build={(f) => [
        {
          key: 'business',
          value: {
            legalName: formText(f, 'legalName').trim(),
            tradeName: formText(f, 'tradeName').trim() || null,
            gstin: gstin.trim().toUpperCase() || null,
            address: {
              line1: formText(f, 'line1').trim(),
              line2: formText(f, 'line2').trim() || null,
              city: formText(f, 'city').trim(),
              stateCode: formText(f, 'stateCode'),
              postalCode: formText(f, 'postalCode').trim(),
            },
            phones: list(formText(f, 'phones')),
            emails: list(formText(f, 'emails')),
            website: formText(f, 'website').trim() || null,
            signatoryName: formText(f, 'signatoryName').trim() || null,
            signatoryDesignation: formText(f, 'signatoryDesignation').trim() || null,
          },
        },
      ]}
    >
      <div className="grid-2">
        <FormField
          id="legalName"
          label="Legal name"
          defaultValue={business?.legalName ?? ''}
          required
        />
        <FormField
          id="tradeName"
          label="Trade name (if different)"
          defaultValue={business?.tradeName ?? ''}
        />
        <FormField
          id="gstin"
          label="GSTIN"
          value={gstin}
          onChange={(e) => setGstin(e.target.value.toUpperCase())}
          maxLength={15}
          error={gstinProblem}
        />
        <FormField
          id="line1"
          label="Address line 1"
          defaultValue={business?.address.line1 ?? ''}
          required
        />
        <FormField id="line2" label="Address line 2" defaultValue={business?.address.line2 ?? ''} />
        <FormField id="city" label="City" defaultValue={business?.address.city ?? ''} required />
        <SelectField
          id="stateCode"
          label="State"
          defaultValue={business?.address.stateCode ?? '19'}
        >
          {INDIAN_STATES.map((st) => (
            <option key={st.code} value={st.code}>
              {st.name} ({st.code})
            </option>
          ))}
        </SelectField>
        <FormField
          id="postalCode"
          label="PIN code"
          defaultValue={business?.address.postalCode ?? ''}
          inputMode="numeric"
          maxLength={6}
          required
        />
        <FormField
          id="phones"
          label="Phone numbers (comma separated)"
          defaultValue={business?.phones.join(', ') ?? ''}
        />
        <FormField
          id="emails"
          label="Email addresses (comma separated)"
          defaultValue={business?.emails.join(', ') ?? ''}
        />
        <FormField id="website" label="Website" defaultValue={business?.website ?? ''} />
        <FormField
          id="signatoryName"
          label="Authorised signatory name"
          defaultValue={business?.signatoryName ?? ''}
        />
        <FormField
          id="signatoryDesignation"
          label="Signatory designation"
          defaultValue={business?.signatoryDesignation ?? ''}
        />
      </div>
    </SettingForm>
  );
}

function TaxForm({
  tax,
  currency,
  canManage,
  onSaved,
}: {
  tax: TaxSettings;
  currency: string | null;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [categories, setCategories] = useState(tax.categories);
  const [approve, setApprove] = useState(tax.status === 'APPROVED');
  const setCategory = (i: number, patch: Partial<TaxSettings['categories'][number]>) =>
    setCategories((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <SettingForm
      label="GST configuration"
      canManage={canManage}
      onSaved={onSaved}
      build={(f) => [
        { key: 'money', value: { currency: formText(f, 'currency').trim().toUpperCase() || null } },
        {
          key: 'tax',
          value: {
            status: approve ? 'APPROVED' : 'DRAFT',
            approval: approve
              ? {
                  approvedBy: formText(f, 'approvedBy').trim(),
                  approvedOn: formText(f, 'approvedOn'),
                  note: formText(f, 'approvalNote').trim() || null,
                }
              : null,
            pricing: 'TAX_EXCLUSIVE',
            roundOff: formText(f, 'roundOff'),
            categories,
            lineTypeCategory: Object.fromEntries(
              ESTIMATE_LINE_TYPES_FOR_TAX.map((t) => [t, formText(f, `map-${t}`)]),
            ),
          },
        },
      ]}
    >
      <p>
        Status:{' '}
        <strong className="badge">
          {tax.status === 'APPROVED'
            ? `Approved by ${tax.approval?.approvedBy ?? ''} on ${tax.approval?.approvedOn ?? ''}`
            : 'Draft — not approved'}
        </strong>
      </p>
      <div className="grid-2">
        <FormField
          id="currency"
          label="Currency (ISO code)"
          defaultValue={currency ?? 'INR'}
          maxLength={3}
        />
        <SelectField id="roundOff" label="Invoice total" defaultValue={tax.roundOff}>
          <option value="NEAREST_RUPEE">Round to the nearest rupee (show round-off)</option>
          <option value="NONE">Do not round</option>
        </SelectField>
      </div>
      <div className="table-wrap">
        <table className="data" aria-label="Tax categories">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Name</th>
              <th scope="col">HSN/SAC</th>
              <th scope="col">GST rate %</th>
              <th scope="col">From date</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c, i) => {
              const latest = [...c.rates].sort((a, b) =>
                b.effectiveFrom.localeCompare(a.effectiveFrom),
              )[0];
              const setRate = (patch: Partial<{ ratePercent: string; effectiveFrom: string }>) =>
                setCategory(i, {
                  rates: c.rates.map((r) => (r === latest ? { ...r, ...patch } : r)),
                });
              return (
                <tr key={c.code}>
                  <td>{c.code}</td>
                  <td>
                    <input
                      aria-label={`Name of ${c.code}`}
                      value={c.name}
                      onChange={(e) => setCategory(i, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`HSN/SAC of ${c.code}`}
                      value={c.hsnSac}
                      inputMode="numeric"
                      onChange={(e) => setCategory(i, { hsnSac: e.target.value.trim() })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`GST rate of ${c.code}`}
                      value={latest?.ratePercent ?? ''}
                      inputMode="decimal"
                      onChange={(e) => setRate({ ratePercent: e.target.value.trim() })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`Rate effective from for ${c.code}`}
                      type="date"
                      value={latest?.effectiveFrom ?? ''}
                      onChange={(e) => setRate({ effectiveFrom: e.target.value })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <fieldset>
        <legend>Category used for each kind of line</legend>
        <div className="grid-2">
          {ESTIMATE_LINE_TYPES_FOR_TAX.map((t) => (
            <SelectField
              key={t}
              id={`map-${t}`}
              label={LINE_TYPE_LABELS[t]}
              defaultValue={tax.lineTypeCategory[t]}
            >
              {categories.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </SelectField>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Accountant approval</legend>
        <label className="checkbox">
          <input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} />{' '}
          The rates, HSN/SAC codes and rules above have been approved by our accountant
        </label>
        {approve ? (
          <div className="grid-2">
            <FormField
              id="approvedBy"
              label="Approved by (name)"
              defaultValue={tax.approval?.approvedBy ?? ''}
              required
            />
            <FormField
              id="approvedOn"
              label="Approved on"
              type="date"
              defaultValue={tax.approval?.approvedOn ?? ''}
              required
            />
            <FormField
              id="approvalNote"
              label="Note (optional)"
              defaultValue={tax.approval?.note ?? ''}
            />
          </div>
        ) : null}
      </fieldset>
    </SettingForm>
  );
}
