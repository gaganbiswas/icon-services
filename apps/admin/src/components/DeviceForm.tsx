import type { AssetCategory, CreatedAssetResponse } from '@icon/contracts';
import { type FormEvent, useState } from 'react';

import { useAuth } from '../lib/auth';
import { fieldErrors, formMessage, formText } from '../lib/form-errors';
import { useResource } from '../lib/use-resource';
import { FormField } from './FormField';
import { SelectField } from './Inputs';
import { ResourceView } from './ResourceView';

/** Adds a device for a customer and surfaces duplicate-serial warnings. */
export function DeviceForm({
  customerId,
  onCreated,
}: {
  customerId: string;
  onCreated: (result: CreatedAssetResponse) => void;
}) {
  const { client } = useAuth();
  const categories = useResource(() => client.get<AssetCategory[]>('/asset-categories'), [client]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const optional = (name: string) =>
      formText(form, name) ? { [name]: formText(form, name) } : {};
    setSaving(true);
    setErrors({});
    setMessage(null);
    try {
      const result = await client.post<CreatedAssetResponse>('/assets', {
        customerId,
        categoryId: formText(form, 'categoryId'),
        brand: formText(form, 'brand'),
        model: formText(form, 'model'),
        ...optional('serialNumber'),
        ...optional('assetTag'),
        ...optional('warrantyEnd'),
        ...optional('warrantyProvider'),
      });
      formElement.reset();
      onCreated(result);
    } catch (caught) {
      setErrors(fieldErrors(caught));
      setMessage(formMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResourceView resource={categories}>
      {(list) => (
        <form onSubmit={(e) => void onSubmit(e)} noValidate aria-label="Add device">
          <div className="grid-2">
            <SelectField id="categoryId" label="Category" required error={errors['categoryId']}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </SelectField>
            <FormField id="brand" label="Brand" required error={errors['brand']} />
            <FormField id="model" label="Model" required error={errors['model']} />
            <FormField id="serialNumber" label="Serial number" error={errors['serialNumber']} />
            <FormField id="assetTag" label="Asset tag (optional)" error={errors['assetTag']} />
            <FormField
              id="warrantyEnd"
              label="Warranty end date (if known)"
              type="date"
              error={errors['warrantyEnd']}
            />
            <FormField
              id="warrantyProvider"
              label="Warranty provider (optional)"
              error={errors['warrantyProvider']}
            />
          </div>
          {message ? (
            <p role="alert" className="form-error">
              {message}
            </p>
          ) : null}
          <div>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Add device'}
            </button>
          </div>
        </form>
      )}
    </ResourceView>
  );
}
