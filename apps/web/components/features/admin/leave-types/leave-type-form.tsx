'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import type {
  AdminLeaveType,
  CreateLeaveTypeInput,
  LeaveKind,
} from '@workpulse/shared-types';
import { createLeaveTypeSchema } from '@workpulse/shared-types';

const LEAVE_KIND_LABELS: Record<LeaveKind, string> = {
  ANNUAL: 'Cuti Tahunan',
  SICK: 'Sakit',
  PERSONAL: 'Cuti Pribadi',
  MATERNITY: 'Cuti Melahirkan',
  PATERNITY: 'Cuti Ayah',
  UNPAID: 'Tanpa Bayar',
  OTHER: 'Lainnya',
};

interface Props {
  initial?: AdminLeaveType | null;
  submitting?: boolean;
  onSubmit: (values: CreateLeaveTypeInput) => void | Promise<void>;
  onCancel: () => void;
}

export function LeaveTypeForm({ initial, submitting, onSubmit, onCancel }: Props): JSX.Element {
  const form = useForm<CreateLeaveTypeInput>({
    resolver: zodResolver(createLeaveTypeSchema),
    defaultValues: {
      code: initial?.code ?? '',
      name: initial?.name ?? '',
      kind: initial?.kind ?? 'ANNUAL',
      defaultAnnualQuota: initial?.defaultAnnualQuota ?? 12,
      carryOverMax: initial?.carryOverMax ?? 0,
      requiresAttachment: initial?.requiresAttachment ?? false,
    },
  });

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 md:grid-cols-2">
      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Kode</label>
        <input
          {...form.register('code')}
          disabled={Boolean(initial)}
          placeholder="ANNUAL"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono uppercase disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground">
          Huruf besar / angka / underscore, tidak bisa diubah setelah dibuat.
        </p>
        {form.formState.errors.code && (
          <p className="text-xs text-destructive">{form.formState.errors.code.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Nama Tampilan</label>
        <input
          {...form.register('name')}
          placeholder="Cuti Tahunan"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        {form.formState.errors.name && (
          <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Kategori</label>
        <select
          {...form.register('kind')}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {(Object.keys(LEAVE_KIND_LABELS) as LeaveKind[]).map((k) => (
            <option key={k} value={k}>
              {LEAVE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Kuota Tahunan Default</label>
        <input
          type="number"
          min={0}
          max={365}
          {...form.register('defaultAnnualQuota', { valueAsNumber: true })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
        />
        {form.formState.errors.defaultAnnualQuota && (
          <p className="text-xs text-destructive">
            {form.formState.errors.defaultAnnualQuota.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">
          Carry-Over Maksimum
        </label>
        <input
          type="number"
          min={0}
          max={365}
          {...form.register('carryOverMax', { valueAsNumber: true })}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
        />
        <p className="text-xs text-muted-foreground">Sisa yang boleh dibawa ke tahun berikutnya.</p>
      </div>

      <div className="space-y-1 md:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('requiresAttachment')} />
          Wajibkan lampiran (mis. surat dokter untuk cuti sakit)
        </label>
      </div>

      <div className="col-span-full flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="rounded-md border px-3 py-1 text-xs">
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-foreground px-3 py-1 text-xs font-medium text-background disabled:opacity-50"
        >
          {submitting ? 'Menyimpan...' : initial ? 'Simpan perubahan' : 'Buat tipe cuti'}
        </button>
      </div>
    </form>
  );
}
