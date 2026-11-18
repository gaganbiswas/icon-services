import type { CreateCustomerRequest, Customer } from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../lib/auth';
import { fieldErrors, formMessage, formText } from '../lib/form-errors';
import { FormField } from './FormField';
import { SelectField } from './Inputs';

/** New-customer form; used on its own page and inside the intake wizard. */
export function CustomerForm({
  onCreated,
  submitLabel = 'Save customer',
}: {
  onCreated: (customer: Customer) => void;
  submitLabel?: string;
}) {
  const { client } = useAuth();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const line1 = formText(form, 'line1');
    const body: CreateCustomerRequest = {
      type: formText(form, 'type') === 'BUSINESS' ? 'BUSINESS' : 'INDIVIDUAL',
      name: formText(form, 'name'),
      phone: formText(form, 'phone'),
      ...(formText(form, 'altPhone') ? { altPhone: formText(form, 'altPhone') } : {}),
      ...(formText(form, 'email') ? { email: formText(form, 'email') } : {}),
      ...(formText(form, 'contactPerson')
        ? { contactPerson: formText(form, 'contactPerson') }
        : {}),
      ...(line1
        ? {
            billingAddress: {
              line1,
              city: formText(form, 'city'),
              countryCode: formText(form, 'countryCode'),
              ...(formText(form, 'postalCode') ? { postalCode: formText(form, 'postalCode') } : {}),
              ...(formText(form, 'region') ? { region: formText(form, 'region') } : {}),
            },
          }
        : {}),
      consents: [
        ...(form.get('consentWhatsapp')
          ? [{ channel: 'WHATSAPP' as const, purpose: 'SERVICE_UPDATES' as const }]
          : []),
        ...(form.get('consentEmail')
          ? [{ channel: 'EMAIL' as const, purpose: 'SERVICE_UPDATES' as const }]
          : []),
      ],
    };
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      onCreated(await client.post<Customer>('/customers', body));
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate aria-label="New customer">
      <div className="grid-2">
        <SelectField id="type" label="Customer type" defaultValue="INDIVIDUAL">
          <option value="INDIVIDUAL">Individual</option>
          <option value="BUSINESS">Business</option>
        </SelectField>
        <FormField
          id="name"
          label="Full name or business name"
          required
          error={errors['name']}
          autoComplete="off"
        />
        <FormField
          id="phone"
          label="Mobile number (with country code)"
          type="tel"
          required
          placeholder="+91 98123 45678"
          error={errors['phone']}
        />
        <FormField
          id="altPhone"
          label="Alternate phone (optional)"
          type="tel"
          error={errors['altPhone']}
        />
        <FormField id="email" label="Email (optional)" type="email" error={errors['email']} />
        <FormField
          id="contactPerson"
          label="Contact person (business, optional)"
          error={errors['contactPerson']}
        />
      </div>
      <fieldset>
        <legend>Billing address (optional)</legend>
        <div className="grid-2">
          <FormField id="line1" label="Address line" error={errors['billingAddress.line1']} />
          <FormField id="city" label="City" error={errors['billingAddress.city']} />
          <FormField id="region" label="State / region" error={errors['billingAddress.region']} />
          <FormField
            id="postalCode"
            label="Postal code"
            error={errors['billingAddress.postalCode']}
          />
          <FormField
            id="countryCode"
            label="Country code (2 letters)"
            maxLength={2}
            error={errors['billingAddress.countryCode']}
          />
        </div>
      </fieldset>
      <fieldset>
        <legend>Service updates the customer agreed to receive</legend>
        <label className="checkbox">
          <input type="checkbox" name="consentWhatsapp" /> WhatsApp
        </label>
        <label className="checkbox">
          <input type="checkbox" name="consentEmail" /> Email
        </label>
      </fieldset>
      {message ? (
        <p role="alert" className="form-error">
          {message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
