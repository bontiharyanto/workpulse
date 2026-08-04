'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateGeofenceInput, Geofence } from '@workpulse/shared-types';
import { createGeofenceSchema } from '@workpulse/shared-types';
import { useForm } from 'react-hook-form';

interface Props {
  initial?: Geofence | null;
  submitting?: boolean;
  onSubmit: (values: CreateGeofenceInput) => void | Promise<void>;
  onCancel: () => void;
}

export function GeofenceForm({ initial, submitting, onSubmit, onCancel }: Props): JSX.Element {
  const form = useForm<CreateGeofenceInput>({
    resolver: zodResolver(createGeofenceSchema),
    defaultValues: {
      name: initial?.name ?? '',
      latitude: initial?.latitude ?? -6.2088,
      longitude: initial?.longitude ?? 106.8456,
      radiusMeters: initial?.radiusMeters ?? 100,
    },
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1 md:col-span-2">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Lokasi</label>
        <input
          {...form.register('name')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Head Office"
        />
        {form.formState.errors.name && (
          <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Latitude</label>
        <input
          type="number"
          step="0.0000001"
          {...form.register('latitude', { valueAsNumber: true })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        {form.formState.errors.latitude && (
          <p className="text-destructive text-xs">{form.formState.errors.latitude.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Longitude</label>
        <input
          type="number"
          step="0.0000001"
          {...form.register('longitude', { valueAsNumber: true })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        {form.formState.errors.longitude && (
          <p className="text-destructive text-xs">{form.formState.errors.longitude.message}</p>
        )}
      </div>

      <div className="space-y-1 md:col-span-2">
        <label className="text-xs font-medium uppercase tracking-wider">Radius (meter)</label>
        <input
          type="number"
          step="1"
          {...form.register('radiusMeters', { valueAsNumber: true })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          Rekomendasi: 30–100m untuk kantor kecil, 200–500m untuk pabrik/kompleks.
        </p>
        {form.formState.errors.radiusMeters && (
          <p className="text-destructive text-xs">{form.formState.errors.radiusMeters.message}</p>
        )}
      </div>

      <div className="col-span-full flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1 text-xs">
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : initial ? 'Simpan perubahan' : 'Buat geofence'}
        </button>
      </div>
    </form>
  );
}
