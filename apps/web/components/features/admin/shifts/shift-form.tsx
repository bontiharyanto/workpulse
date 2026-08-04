'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateShiftInput, Geofence, Shift, ShiftType } from '@workpulse/shared-types';
import { createShiftSchema } from '@workpulse/shared-types';
import { useForm } from 'react-hook-form';

const TYPE_LABELS: Record<ShiftType, string> = {
  STATIC: 'STATIC — jam tetap',
  FLEXIBLE: 'FLEXIBLE — jam fleksibel',
  ROTATING: 'ROTATING — rotasi',
};

interface Props {
  initial?: Shift | null;
  geofences: Geofence[];
  submitting?: boolean;
  onSubmit: (values: CreateShiftInput) => void | Promise<void>;
  onCancel: () => void;
}

export function ShiftForm({
  initial,
  geofences,
  submitting,
  onSubmit,
  onCancel,
}: Props): JSX.Element {
  const form = useForm<CreateShiftInput>({
    resolver: zodResolver(createShiftSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? 'STATIC',
      startTime: initial?.startTime ?? '08:00',
      endTime: initial?.endTime ?? '17:00',
      graceMinutes: initial?.graceMinutes ?? 10,
      geofenceId: initial?.geofenceId ?? undefined,
    },
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1 md:col-span-2">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Shift</label>
        <input
          {...form.register('name')}
          placeholder="Shift Pagi"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {form.formState.errors.name && (
          <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Tipe</label>
        <select
          {...form.register('type')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          {(Object.keys(TYPE_LABELS) as ShiftType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Toleransi (grace, menit)
        </label>
        <input
          type="number"
          min={0}
          max={240}
          {...form.register('graceMinutes', { valueAsNumber: true })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Jam Mulai (HH:mm)</label>
        <input
          type="time"
          {...form.register('startTime')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        {form.formState.errors.startTime && (
          <p className="text-destructive text-xs">{form.formState.errors.startTime.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Jam Selesai (HH:mm)</label>
        <input
          type="time"
          {...form.register('endTime')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        <p className="text-muted-foreground text-xs">
          Untuk shift lintas tengah malam, jam selesai boleh &lt; jam mulai.
        </p>
        {form.formState.errors.endTime && (
          <p className="text-destructive text-xs">{form.formState.errors.endTime.message}</p>
        )}
      </div>

      <div className="space-y-1 md:col-span-2">
        <label className="text-xs font-medium uppercase tracking-wider">Geofence (opsional)</label>
        <select
          {...form.register('geofenceId', {
            setValueAs: (v: string) => (v === '' ? null : v),
          })}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        >
          <option value="">— Tidak dibatasi lokasi —</option>
          {geofences.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} · r={g.radiusMeters}m
            </option>
          ))}
        </select>
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
          {submitting ? 'Menyimpan...' : initial ? 'Simpan perubahan' : 'Buat shift'}
        </button>
      </div>
    </form>
  );
}
