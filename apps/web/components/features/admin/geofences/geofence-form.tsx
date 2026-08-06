'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateGeofenceInput, Geofence } from '@workpulse/shared-types';
import { createGeofenceSchema } from '@workpulse/shared-types';
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

import { GEOFENCE_TEMPLATES_JAKARTA_CBD } from './geofence-templates';

/**
 * Leaflet accesses `window` on import, so the picker is loaded
 * client-only. `ssr: false` also prevents the tile CSS from being
 * shipped to server-render, keeping the initial HTML tiny.
 */
const GeofenceMapPicker = dynamic(
  () => import('./geofence-map-picker').then((m) => m.GeofenceMapPicker),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[340px] w-full" />
      </div>
    ),
  },
);

interface Props {
  initial?: Geofence | null;
  submitting?: boolean;
  onSubmit: (values: CreateGeofenceInput) => void | Promise<void>;
  onCancel: () => void;
}

export function GeofenceForm({
  initial,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const form = useForm<CreateGeofenceInput>({
    resolver: zodResolver(createGeofenceSchema),
    defaultValues: {
      name: initial?.name ?? '',
      latitude: initial?.latitude ?? -6.2088,
      longitude: initial?.longitude ?? 106.8456,
      radiusMeters: initial?.radiusMeters ?? 100,
      maxAccuracyMeters: initial?.maxAccuracyMeters ?? null,
      allowedSsids: initial?.allowedSsids ?? [],
    },
  });

  // Watch the three coordinate fields together so the map and the
  // manual inputs stay in sync. We use `watch()` rather than a
  // separate state to keep RHF as the single source of truth.
  const latitude = form.watch('latitude');
  const longitude = form.watch('longitude');
  const radiusMeters = form.watch('radiusMeters');

  const applyTemplate = useCallback(
    (t: { latitude: number; longitude: number; radiusMeters: number; label: string }) => {
      form.setValue('latitude', t.latitude, { shouldDirty: true, shouldValidate: true });
      form.setValue('longitude', t.longitude, { shouldDirty: true, shouldValidate: true });
      form.setValue('radiusMeters', t.radiusMeters, { shouldDirty: true, shouldValidate: true });
      // Only prefill the name on CREATE — never overwrite an existing
      // custom name on edit.
      if (!initial && !form.getValues('name').trim()) {
        form.setValue('name', t.label, { shouldDirty: true, shouldValidate: true });
      }
    },
    [form, initial],
  );

  const handleMapChange = useCallback(
    (next: { latitude: number; longitude: number; radiusMeters: number }) => {
      form.setValue('latitude', next.latitude, { shouldDirty: true, shouldValidate: true });
      form.setValue('longitude', next.longitude, { shouldDirty: true, shouldValidate: true });
      // Radius is edited via the slider/input below the map; the map
      // itself only moves the pin.
    },
    [form],
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-1">
        <Label htmlFor="geofence-name" className="text-xs uppercase tracking-wider">
          Nama Lokasi
        </Label>
        <Input
          id="geofence-name"
          {...form.register('name')}
          placeholder="Head Office Jakarta"
        />
        {form.formState.errors.name && (
          <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
        )}
      </div>

      {!initial ? (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wider">Template (opsional)</Label>
          <p className="text-muted-foreground text-xs">
            Klik salah satu template Jakarta CBD di bawah untuk mengisi otomatis.
          </p>
          <div className="flex flex-wrap gap-2">
            {GEOFENCE_TEMPLATES_JAKARTA_CBD.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t)}
                className="border-input bg-background hover:bg-accent rounded-md border px-2.5 py-1 text-xs transition-colors"
                title={t.description}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label className="text-xs uppercase tracking-wider">Lokasi Geofence</Label>
        <p className="text-muted-foreground text-xs">
          Klik peta atau seret pin untuk memindahkan pusat geofence. Gunakan tombol{' '}
          <span className="font-medium">lokasi saat ini</span> atau ketik alamat di kotak
          pencarian.
        </p>
        <GeofenceMapPicker
          value={{ latitude, longitude, radiusMeters }}
          onChange={handleMapChange}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="geofence-lat" className="text-xs uppercase tracking-wider">
            Latitude
          </Label>
          <Input
            id="geofence-lat"
            type="number"
            step="0.0000001"
            className="tabular-nums"
            {...form.register('latitude', { valueAsNumber: true })}
          />
          {form.formState.errors.latitude && (
            <p className="text-destructive text-xs">
              {form.formState.errors.latitude.message}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="geofence-lng" className="text-xs uppercase tracking-wider">
            Longitude
          </Label>
          <Input
            id="geofence-lng"
            type="number"
            step="0.0000001"
            className="tabular-nums"
            {...form.register('longitude', { valueAsNumber: true })}
          />
          {form.formState.errors.longitude && (
            <p className="text-destructive text-xs">
              {form.formState.errors.longitude.message}
            </p>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="geofence-radius" className="text-xs uppercase tracking-wider">
            Radius (meter)
          </Label>
          <Input
            id="geofence-radius"
            type="number"
            step="1"
            className="tabular-nums"
            {...form.register('radiusMeters', { valueAsNumber: true })}
          />
          {form.formState.errors.radiusMeters && (
            <p className="text-destructive text-xs">
              {form.formState.errors.radiusMeters.message}
            </p>
          )}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Rekomendasi: 30–100 m untuk kantor kecil, 200–500 m untuk pabrik / kompleks. Maksimum
        5000 m.
      </p>

      <details className="border-input rounded-md border">
        <summary className="hover:bg-accent cursor-pointer select-none px-3 py-2 text-sm font-medium">
          Pengaturan lanjutan (opsional)
        </summary>
        <div className="space-y-4 border-t p-4">
          <AccuracyBudgetField
            value={form.watch('maxAccuracyMeters') ?? null}
            onChange={(v) =>
              form.setValue('maxAccuracyMeters', v, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          {form.formState.errors.maxAccuracyMeters ? (
            <p className="text-destructive text-xs">
              {form.formState.errors.maxAccuracyMeters.message}
            </p>
          ) : null}

          <SsidAllowlistField
            value={form.watch('allowedSsids') ?? []}
            onChange={(v) =>
              form.setValue('allowedSsids', v, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Menyimpan…' : initial ? 'Simpan perubahan' : 'Buat geofence'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Two-state control: a checkbox toggling the accuracy budget on/off,
 * and — when on — a numeric input with the threshold. Persisted as
 * `null` when off, matches the server contract.
 */
function AccuracyBudgetField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          id="geofence-acc-toggle"
          type="checkbox"
          checked={value !== null}
          onChange={(e) => onChange(e.target.checked ? 100 : null)}
          className="h-4 w-4 rounded border"
        />
        <Label htmlFor="geofence-acc-toggle" className="text-sm font-normal">
          Aktifkan batas akurasi GPS
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">
        Jika aktif, clock-in dengan akurasi GPS lebih buruk dari nilai ini akan ditolak
        dengan <code>WEAK_GPS_ACCURACY</code>. Efektif untuk mencegah clock-in dari device
        yang meng-geolokasi lewat IP.
      </p>
      {value !== null ? (
        <div className="ml-6 flex items-center gap-2">
          <Input
            type="number"
            step="1"
            min="10"
            max="500"
            value={value}
            onChange={(e) => {
              const parsed = Number.parseInt(e.target.value, 10);
              onChange(Number.isFinite(parsed) ? parsed : 100);
            }}
            className="w-32 tabular-nums"
          />
          <span className="text-muted-foreground text-xs">meter (rentang 10–500)</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Wi-Fi SSID allowlist editor. Enter/Add pushes the current input as
 * a new pill; the pill can be removed. Trimmed and deduplicated
 * client-side (server does the same as a defensive measure).
 */
function SsidAllowlistField({
  value,
  onChange,
}: {
  value: string[];
  onChange: (v: string[]) => void;
}): JSX.Element {
  const [draft, setDraft] = useState('');

  const push = useCallback(() => {
    const clean = draft.trim();
    if (!clean) return;
    if (value.includes(clean)) {
      setDraft('');
      return;
    }
    if (value.length >= 10) return;
    onChange([...value, clean]);
    setDraft('');
  }, [draft, onChange, value]);

  return (
    <div className="space-y-2">
      <Label className="text-sm font-normal">Wi-Fi SSID allowlist (indoor fallback)</Label>
      <p className="text-muted-foreground text-xs">
        Jika mobile app melaporkan SSID yang cocok dengan salah satu di bawah, clock-in
        diterima meski GPS di luar radius. Cocok untuk gedung indoor GPS jelek. Browser web
        <span className="italic"> tidak dapat </span>memberikan SSID.
      </p>
      <div className="flex flex-wrap gap-2">
        {value.map((s) => (
          <span
            key={s}
            className="bg-secondary text-secondary-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs"
          >
            <code>{s}</code>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== s))}
              aria-label={`Hapus ${s}`}
              className="hover:text-destructive"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          value={draft}
          placeholder="Contoh: OFFICE-WIFI-JKT"
          maxLength={64}
          disabled={value.length >= 10}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              push();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={push}
          disabled={value.length >= 10 || draft.trim().length === 0}
        >
          Tambah
        </Button>
      </div>
      {value.length >= 10 ? (
        <p className="text-muted-foreground text-xs">Maksimum 10 SSID per geofence.</p>
      ) : null}
    </div>
  );
}
