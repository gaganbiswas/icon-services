import type {
  Asset,
  AssetCategory,
  CustomerComplaintRequest,
  CustomerJob,
  StoredFileInfo,
} from '@icon/contracts';
import * as ImagePicker from 'expo-image-picker';
import { useRef, useState } from 'react';

import { type UploadablePhoto, errorMessage, newIdempotencyKey } from '../api/client';
import { Body, Button, Choice, ErrorText, Field, Screen, Title } from '../components/ui';
import { useSession } from '../session';
import { useLoad } from '../use-load';

/** Opens the photo library; returns null when cancelled. */
export async function pickPhoto(): Promise<UploadablePhoto | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
  });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  return {
    uri: asset.uri,
    name: asset.fileName ?? 'photo.jpg',
    type: asset.mimeType ?? 'image/jpeg',
  };
}

type Loaded = [{ id: string; name: string }[], AssetCategory[], Asset[]];

export function NewRequestScreen({
  onSubmitted,
  choosePhoto = pickPhoto,
}: {
  onSubmitted: (job: CustomerJob) => void;
  choosePhoto?: () => Promise<UploadablePhoto | null>;
}) {
  const { api } = useSession();
  const [data, reload] = useLoad(
    () => Promise.all([api.branches(), api.categories(), api.devices()]) as Promise<Loaded>,
    [api],
  );
  const [branchId, setBranchId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [warranty, setWarranty] = useState<CustomerComplaintRequest['warrantyClaim']>('NOT_SURE');
  const [mode, setMode] = useState<CustomerComplaintRequest['serviceMode']>('AT_SERVICE_CENTRE');
  const [complaint, setComplaint] = useState('');
  const [accessories, setAccessories] = useState('');
  const [line1, setLine1] = useState('');
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [photos, setPhotos] = useState<StoredFileInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Reuse the key only when retrying the identical request (network failure).
  const lastAttempt = useRef<{ body: string; key: string } | null>(null);

  if (data.status !== 'ready') {
    return (
      <Screen>
        <Title>New service request</Title>
        {data.status === 'loading' ? (
          <Body muted>Loading…</Body>
        ) : (
          <ErrorText>{data.message}</ErrorText>
        )}
        {data.status === 'error' ? (
          <Button label="Try again" variant="secondary" onPress={reload} />
        ) : null}
      </Screen>
    );
  }
  const [branches, categories, devices] = data.data;
  const selectedBranch = branchId ?? (branches.length === 1 ? (branches[0]?.id ?? null) : null);
  const usingNewDevice = deviceId === 'NEW' || devices.length === 0;

  async function addPhoto() {
    setError(null);
    try {
      const photo = await choosePhoto();
      if (!photo) return;
      setBusy(true);
      const uploaded = await api.uploadPhoto(photo);
      setPhotos((current) => [...current, uploaded]);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function buildRequest(): CustomerComplaintRequest | string {
    if (!selectedBranch) return 'Choose a service centre.';
    if (complaint.trim().length < 5) return 'Describe the problem (at least 5 characters).';
    if (usingNewDevice && (!categoryId || !brand.trim() || !model.trim()))
      return 'Enter the device type, brand and model.';
    if (!usingNewDevice && !deviceId) return 'Choose your device.';
    if (mode === 'ON_SITE' && (!line1.trim() || !city.trim() || country.trim().length !== 2))
      return 'Enter the address for the on-site visit.';
    return {
      branchId: selectedBranch,
      ...(usingNewDevice
        ? {
            newAsset: {
              categoryId: categoryId ?? '',
              brand: brand.trim(),
              model: model.trim(),
              ...(serial.trim() ? { serialNumber: serial.trim() } : {}),
            },
          }
        : { assetId: deviceId ?? '' }),
      warrantyClaim: warranty,
      serviceMode: mode,
      complaint: complaint.trim(),
      accessories: accessories
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      ...(mode === 'ON_SITE'
        ? {
            serviceAddress: {
              line1: line1.trim(),
              city: city.trim(),
              countryCode: country.trim().toUpperCase(),
            },
          }
        : {}),
      photoFileIds: photos.map((p) => p.id),
    };
  }

  async function submit() {
    const request = buildRequest();
    if (typeof request === 'string') {
      setError(request);
      return;
    }
    const body = JSON.stringify(request);
    const key = lastAttempt.current?.body === body ? lastAttempt.current.key : newIdempotencyKey();
    lastAttempt.current = { body, key };
    setBusy(true);
    setError(null);
    try {
      onSubmitted(await api.submitComplaint(request, key));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title>New service request</Title>
      {branches.length > 1 ? (
        <Choice
          label="Service centre"
          options={branches.map((b) => ({ value: b.id, label: b.name }))}
          value={selectedBranch}
          onChange={setBranchId}
        />
      ) : null}
      {devices.length > 0 ? (
        <Choice
          label="Device"
          options={[
            ...devices.map((d) => ({
              value: d.id,
              label: `${d.category.name}: ${d.brand} ${d.model}`,
            })),
            { value: 'NEW', label: 'Another device' },
          ]}
          value={deviceId}
          onChange={setDeviceId}
        />
      ) : null}
      {usingNewDevice ? (
        <>
          <Choice
            label="Device type"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={categoryId}
            onChange={setCategoryId}
          />
          <Field label="Brand" value={brand} onChangeText={setBrand} />
          <Field label="Model" value={model} onChangeText={setModel} />
          <Field
            label="Serial number (optional)"
            value={serial}
            onChangeText={setSerial}
            autoCapitalize="characters"
          />
        </>
      ) : null}
      <Choice
        label="Is the device under warranty?"
        options={[
          { value: 'IN_WARRANTY', label: 'Yes' },
          { value: 'OUT_OF_WARRANTY', label: 'No' },
          { value: 'NOT_SURE', label: 'Not sure' },
        ]}
        value={warranty}
        onChange={setWarranty}
      />
      <Choice
        label="Where should we service it?"
        options={[
          { value: 'AT_SERVICE_CENTRE', label: 'I will bring it to the service centre' },
          { value: 'ON_SITE', label: 'Visit me on-site' },
        ]}
        value={mode}
        onChange={setMode}
      />
      {mode === 'ON_SITE' ? (
        <>
          <Field
            label="Address"
            value={line1}
            onChangeText={setLine1}
            autoComplete="street-address"
          />
          <Field label="City" value={city} onChangeText={setCity} />
          <Field
            label="Country code (2 letters)"
            value={country}
            onChangeText={setCountry}
            maxLength={2}
            autoCapitalize="characters"
          />
        </>
      ) : null}
      <Field
        label="Describe the problem"
        value={complaint}
        onChangeText={setComplaint}
        multiline
        numberOfLines={4}
      />
      <Field
        label="Accessories you will hand over (comma separated)"
        value={accessories}
        onChangeText={setAccessories}
      />
      <Body muted>{photos.length} photo(s) attached</Body>
      <Button
        label="Add a photo"
        variant="secondary"
        onPress={() => void addPhoto()}
        disabled={busy || photos.length >= 6}
      />
      <ErrorText>{error}</ErrorText>
      <Button label="Submit request" onPress={() => void submit()} busy={busy} />
    </Screen>
  );
}
