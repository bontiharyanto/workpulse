'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  timesheetConfigBounds,
  updateTimesheetConfigInputSchema,
  type UpdateTimesheetConfigInput,
} from '@workpulse/shared-types';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, timesheetConfigApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  TIMESHEET_CONFIG_INVALID: 'Konfigurasi timesheet tidak valid.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

/**
 * `/admin/timesheet/config` panel (Fase 32a). HR / Super Admin only.
 *
 * The form is period-type aware:
 *   - WEEKLY   → shows weekStartDay
 *   - BIWEEKLY → shows biweeklyAnchor (calendar date)
 *   - MONTHLY  → hides all optional fields
 *   - CUTOFF   → shows cutoffDayOfMonth (1..28)
 */
export function TimesheetConfigPanel(): JSX.Element {
  const qc = useQueryClient();
  const [saved, setSaved] = useState<'idle' | 'saved'>('idle');

  const config = useQuery({
    queryKey: ['timesheet-config'],
    queryFn: () => timesheetConfigApi.get(),
    staleTime: 60_000,
  });

  const form = useForm<UpdateTimesheetConfigInput>({
    resolver: zodResolver(updateTimesheetConfigInputSchema),
    defaultValues: {
      periodType: 'MONTHLY',
      weekStartDay: 'MONDAY',
      biweeklyAnchor: null,
      cutoffDayOfMonth: null,
      timezone: 'Asia/Jakarta',
      autoGenerateEnabled: true,
      reminderEnabled: true,
      submitReminderStartDays: 1,
      submitReminderMaxDays: 7,
      approvalReminderStartDays: 2,
      approvalReminderMaxDays: 14,
    },
  });

  useEffect(() => {
    if (!config.data) return;
    form.reset({
      periodType: config.data.periodType,
      weekStartDay: config.data.weekStartDay,
      biweeklyAnchor: config.data.biweeklyAnchor,
      cutoffDayOfMonth: config.data.cutoffDayOfMonth,
      timezone: config.data.timezone,
      autoGenerateEnabled: config.data.autoGenerateEnabled,
      reminderEnabled: config.data.reminderEnabled,
      submitReminderStartDays: config.data.submitReminderStartDays,
      submitReminderMaxDays: config.data.submitReminderMaxDays,
      approvalReminderStartDays: config.data.approvalReminderStartDays,
      approvalReminderMaxDays: config.data.approvalReminderMaxDays,
    });
  }, [config.data, form]);

  const mutation = useMutation({
    mutationFn: (input: UpdateTimesheetConfigInput) =>
      timesheetConfigApi.update(input),
    onSuccess: async () => {
      setSaved('saved');
      await qc.invalidateQueries({ queryKey: ['timesheet-config'] });
      window.setTimeout(() => setSaved('idle'), 3_000);
    },
  });

  const inlineError = mutation.error
    ? mutation.error instanceof ApiError
      ? (ERROR_COPY[mutation.error.code] ?? mutation.error.message)
      : 'Terjadi kesalahan saat menyimpan.'
    : null;

  const onSubmit = form.handleSubmit((values) => {
    mutation.mutate(values);
  });

  const periodType = form.watch('periodType');

  if (config.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
      >
        Memuat konfigurasi timesheet…
      </div>
    );
  }

  if (config.isError || !config.data) {
    return (
      <div
        role="alert"
        className="rounded-md border border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive"
      >
        Gagal memuat konfigurasi. Coba muat ulang halaman.
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6 rounded-lg border border-border bg-card p-6"
      aria-labelledby="tsc-heading"
    >
      <div className="space-y-1">
        <h2 id="tsc-heading" className="text-lg font-semibold">
          Konfigurasi timesheet
        </h2>
        <p className="text-sm text-muted-foreground">
          Tentukan jenis periode dan zona waktu tenant. Perubahan berlaku
          pada generate timesheet berikutnya.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1">
          <label
            htmlFor="periodType"
            className="text-sm font-medium text-foreground"
          >
            Jenis periode
          </label>
          <select
            id="periodType"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            {...form.register('periodType')}
          >
            <option value="WEEKLY">Mingguan (7 hari)</option>
            <option value="BIWEEKLY">Dua-mingguan (14 hari)</option>
            <option value="MONTHLY">Bulanan (kalender)</option>
            <option value="CUTOFF">Cutoff harian</option>
          </select>
        </div>

        {periodType === 'WEEKLY' ? (
          <div className="space-y-1">
            <label
              htmlFor="weekStartDay"
              className="text-sm font-medium text-foreground"
            >
              Hari awal minggu
            </label>
            <select
              id="weekStartDay"
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('weekStartDay')}
            >
              <option value="MONDAY">Senin</option>
              <option value="SUNDAY">Minggu</option>
            </select>
          </div>
        ) : null}

        {periodType === 'BIWEEKLY' ? (
          <div className="space-y-1">
            <label
              htmlFor="biweeklyAnchor"
              className="text-sm font-medium text-foreground"
            >
              Anchor bi-weekly (tanggal referensi)
            </label>
            <input
              id="biweeklyAnchor"
              type="date"
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('biweeklyAnchor')}
            />
            <p className="text-xs text-muted-foreground">
              Setiap periode 14 hari dihitung dari tanggal ini. Opsional —
              kalau kosong sistem pakai anchor default.
            </p>
          </div>
        ) : null}

        {periodType === 'CUTOFF' ? (
          <div className="space-y-1">
            <label
              htmlFor="cutoffDayOfMonth"
              className="text-sm font-medium text-foreground"
            >
              Tanggal cutoff bulanan (1–28)
            </label>
            <input
              id="cutoffDayOfMonth"
              type="number"
              min={timesheetConfigBounds.cutoffDayOfMonth.min}
              max={timesheetConfigBounds.cutoffDayOfMonth.max}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('cutoffDayOfMonth', { valueAsNumber: true })}
            />
            <p className="text-xs text-muted-foreground">
              Contoh: 25 → periode 26 bulan lalu s/d 25 bulan ini.
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <label
            htmlFor="timezone"
            className="text-sm font-medium text-foreground"
          >
            Zona waktu
          </label>
          <input
            id="timezone"
            type="text"
            className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            {...form.register('timezone')}
          />
          <p className="text-xs text-muted-foreground">
            IANA timezone, e.g. <code>Asia/Jakarta</code>.
          </p>
        </div>
      </div>

      <fieldset className="space-y-4 rounded-md border border-border p-4">
        <legend className="px-1 text-sm font-semibold text-foreground">
          Otomasi &amp; pengingat
        </legend>
        <p className="text-xs text-muted-foreground">
          Scheduler harian menjalankan tugas ini pada 03:00 UTC (~10:00 WIB)
          untuk setiap tenant.
        </p>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            {...form.register('autoGenerateEnabled')}
          />
          <span>
            <span className="font-medium">Auto-generate periode berikutnya</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Saat periode ditutup, sistem otomatis membuat periode &amp; DRAFT
              timesheet untuk setiap karyawan aktif.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-input"
            {...form.register('reminderEnabled')}
          />
          <span>
            <span className="font-medium">Kirim reminder otomatis</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Karyawan yang belum submit &amp; approver yang menunda review
              akan dinotifikasi setiap hari selama window di bawah.
            </span>
          </span>
        </label>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="space-y-1">
            <label
              htmlFor="submitStart"
              className="text-xs font-medium text-foreground"
            >
              Submit reminder mulai (hari ke-)
            </label>
            <input
              id="submitStart"
              type="number"
              min={timesheetConfigBounds.submitReminderStartDays.min}
              max={timesheetConfigBounds.submitReminderStartDays.max}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('submitReminderStartDays', {
                valueAsNumber: true,
              })}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="submitMax"
              className="text-xs font-medium text-foreground"
            >
              Submit reminder berhenti (hari ke-)
            </label>
            <input
              id="submitMax"
              type="number"
              min={timesheetConfigBounds.submitReminderMaxDays.min}
              max={timesheetConfigBounds.submitReminderMaxDays.max}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('submitReminderMaxDays', {
                valueAsNumber: true,
              })}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="approvalStart"
              className="text-xs font-medium text-foreground"
            >
              Approval reminder mulai (hari ke-)
            </label>
            <input
              id="approvalStart"
              type="number"
              min={timesheetConfigBounds.approvalReminderStartDays.min}
              max={timesheetConfigBounds.approvalReminderStartDays.max}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('approvalReminderStartDays', {
                valueAsNumber: true,
              })}
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="approvalMax"
              className="text-xs font-medium text-foreground"
            >
              Approval reminder berhenti (hari ke-)
            </label>
            <input
              id="approvalMax"
              type="number"
              min={timesheetConfigBounds.approvalReminderMaxDays.min}
              max={timesheetConfigBounds.approvalReminderMaxDays.max}
              className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              {...form.register('approvalReminderMaxDays', {
                valueAsNumber: true,
              })}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Range: 0..30 (mulai) / 1..60 (berhenti). Nilai &ldquo;berhenti&rdquo;
          harus &gt;= &ldquo;mulai&rdquo;.
        </p>
      </fieldset>

      {inlineError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {inlineError}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p
          role="status"
          aria-live="polite"
          className="text-xs text-muted-foreground"
        >
          {saved === 'saved' ? 'Perubahan tersimpan.' : ''}
        </p>
        <button
          type="submit"
          disabled={mutation.isPending || !form.formState.isDirty}
          className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Menyimpan…' : 'Simpan konfigurasi'}
        </button>
      </div>
    </form>
  );
}
