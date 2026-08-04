'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CreateHolidayInput, Holiday } from '@workpulse/shared-types';
import { createHolidaySchema } from '@workpulse/shared-types';
import { useForm } from 'react-hook-form';

interface Props {
  initial?: Holiday | null;
  submitting?: boolean;
  onSubmit: (values: CreateHolidayInput) => void | Promise<void>;
  onCancel: () => void;
}

export function HolidayForm({ initial, submitting, onSubmit, onCancel }: Props): JSX.Element {
  const form = useForm<CreateHolidayInput>({
    resolver: zodResolver(createHolidaySchema),
    defaultValues: {
      date: initial?.date ?? new Date().toISOString().slice(0, 10),
      name: initial?.name ?? '',
    },
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Tanggal</label>
        <input
          type="date"
          {...form.register('date')}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
        />
        {form.formState.errors.date && (
          <p className="text-destructive text-xs">{form.formState.errors.date.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Hari Libur</label>
        <input
          {...form.register('name')}
          placeholder="Tahun Baru Masehi"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        {form.formState.errors.name && (
          <p className="text-destructive text-xs">{form.formState.errors.name.message}</p>
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
          {submitting ? 'Menyimpan...' : initial ? 'Simpan perubahan' : 'Tambah hari libur'}
        </button>
      </div>
    </form>
  );
}
