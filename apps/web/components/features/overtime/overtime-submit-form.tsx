'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { overtimeRequestInputSchema, type OvertimeRequestInput } from '@workpulse/shared-types';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, overtimeApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  INVALID_DATE: 'Format tanggal tidak valid.',
  WORK_DATE_IN_FUTURE: 'Tanggal kerja tidak boleh di masa depan.',
  OUTSIDE_SUBMIT_WINDOW: 'Tanggal kerja di luar jendela pengajuan yang diizinkan (biasanya H-14).',
  DUPLICATE_WORK_DATE: 'Sudah ada pengajuan lembur aktif untuk tanggal tersebut.',
  HOURS_EXCEEDS_DAILY_CAP: 'Jam lembur melebihi batas harian yang diizinkan perusahaan.',
  HOURS_NOT_POSITIVE: 'Jam lembur harus lebih dari 0.',
  HOURS_TOO_MANY_DECIMALS: 'Jam lembur maksimum 2 angka di belakang koma.',
  OVERTIME_RATE_NOT_CONFIGURED:
    'Tarif lembur belum dikonfigurasi. Hubungi HR untuk mengatur tarif.',
  USER_NOT_FOUND: 'Data akun tidak ditemukan.',
};

export function OvertimeSubmitForm(): JSX.Element {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const form = useForm<OvertimeRequestInput>({
    resolver: zodResolver(overtimeRequestInputSchema),
    mode: 'onTouched',
    defaultValues: { workDate: '', hours: 1, reason: '' },
  });

  const submit = useMutation({
    mutationFn: (values: OvertimeRequestInput) => overtimeApi.submit(values),
    onSuccess: () => {
      setError(null);
      setOk('Pengajuan lembur berhasil dikirim.');
      form.reset();
      void qc.invalidateQueries({ queryKey: ['overtime'] });
    },
    onError: (err) => {
      setOk(null);
      if (err instanceof ApiError) setError(ERROR_COPY[err.code] ?? err.message);
      else if (err instanceof Error) setError(err.message);
      else setError('Terjadi kesalahan yang tidak terduga.');
    },
  });

  const onSubmit = form.handleSubmit((values) =>
    submit.mutate({ ...values, hours: Number(values.hours) }),
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm" noValidate>
      <h2 className="text-lg font-medium">Ajukan Lembur</h2>

      <div className="space-y-1">
        <label htmlFor="ot-workDate" className="text-sm font-medium">
          Tanggal Lembur
        </label>
        <input
          id="ot-workDate"
          type="date"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          {...form.register('workDate')}
        />
        {form.formState.errors.workDate && (
          <p role="alert" className="text-destructive text-xs">
            {form.formState.errors.workDate.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="ot-hours" className="text-sm font-medium">
          Jumlah Jam (0,25 – 12)
        </label>
        <input
          id="ot-hours"
          type="number"
          step="0.25"
          min="0.25"
          max="12"
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          {...form.register('hours', { valueAsNumber: true })}
        />
        {form.formState.errors.hours && (
          <p role="alert" className="text-destructive text-xs">
            {form.formState.errors.hours.message}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="ot-reason" className="text-sm font-medium">
          Alasan
        </label>
        <textarea
          id="ot-reason"
          rows={3}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          placeholder="Deadline release / support incident / …"
          {...form.register('reason')}
        />
        {form.formState.errors.reason && (
          <p role="alert" className="text-destructive text-xs">
            {form.formState.errors.reason.message}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {error}
        </p>
      )}
      {ok && (
        <p
          role="status"
          className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {ok}
        </p>
      )}

      <button
        type="submit"
        disabled={submit.isPending}
        className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium shadow hover:opacity-90 disabled:opacity-50"
      >
        {submit.isPending ? 'Mengirim...' : 'Ajukan'}
      </button>
    </form>
  );
}
