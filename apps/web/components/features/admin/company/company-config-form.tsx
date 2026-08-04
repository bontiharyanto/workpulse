'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CompanyConfig, CompanyConfigUpdateInput } from '@workpulse/shared-types';
import { companyConfigUpdateInputSchema } from '@workpulse/shared-types';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { Control } from 'react-hook-form';

interface Props {
  initial: CompanyConfig;
  submitting?: boolean;
  onSubmit: (values: CompanyConfigUpdateInput) => void | Promise<void>;
}

/**
 * Two-section form for the company configuration:
 *   1. Identitas (name, timezone)
 *   2. Kebijakan Lembur (rates, multipliers, caps)
 *
 * All fields are optional in `CompanyConfigUpdateInput` — we build a *diff*
 * against `initial` in `onSubmit` so a submission includes only the fields
 * the user actually changed. This preserves the audit trail semantics
 * enforced on the backend (only differing fields are logged).
 */
export function CompanyConfigForm({ initial, submitting, onSubmit }: Props): JSX.Element {
  const form = useForm<FormValues>({
    resolver: zodResolver(companyConfigUpdateInputSchema),
    defaultValues: {
      name: initial.name,
      timezone: initial.timezone,
      overtimeHourlyRate: initial.overtimeHourlyRate,
      overtimeWeekdayMultiplier: initial.overtimeWeekdayMultiplier,
      overtimeWeekendMultiplier: initial.overtimeWeekendMultiplier,
      overtimeHolidayMultiplier: initial.overtimeHolidayMultiplier,
      overtimeMaxHoursPerDay: initial.overtimeMaxHoursPerDay,
      overtimeSubmitWindowDays: initial.overtimeSubmitWindowDays,
      overtimeCompleteGraceDays: initial.overtimeCompleteGraceDays,
      payrollLockedUntil: initial.payrollLockedUntil,
    },
  });

  const handleValidated = async (values: FormValues) => {
    // Only include fields that actually changed relative to `initial`. This
    // shrinks the audit log payload and matches the backend's diff logic.
    const patch: CompanyConfigUpdateInput = {};
    for (const key of Object.keys(values) as (keyof FormValues)[]) {
      if (values[key] !== initial[key]) {
        (patch as Record<string, unknown>)[key] = values[key];
      }
    }
    await onSubmit(patch);
  };

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(handleValidated)} className="space-y-8">
      <IdentitySection form={form} errors={errors} slug={initial.slug} />
      <OvertimePolicySection form={form} errors={errors} />
      <OvertimePreview control={form.control} />
      <PayrollLockSection form={form} errors={errors} />

      <div className="flex justify-end gap-2 border-t pt-4">
        <button
          type="button"
          onClick={() => form.reset()}
          className="rounded-md border px-3 py-2 text-xs"
        >
          Reset
        </button>
        <button
          type="submit"
          disabled={submitting || !form.formState.isDirty}
          className="bg-foreground text-background rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
        >
          {submitting ? 'Menyimpan…' : 'Simpan perubahan'}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type FormValues = {
  name: string;
  timezone: string;
  overtimeHourlyRate: number | null;
  overtimeWeekdayMultiplier: number;
  overtimeWeekendMultiplier: number;
  overtimeHolidayMultiplier: number;
  overtimeMaxHoursPerDay: number;
  overtimeSubmitWindowDays: number;
  overtimeCompleteGraceDays: number;
  payrollLockedUntil: string | null;
};

type FormReturn = ReturnType<typeof useForm<FormValues>>;
type FieldErrors = FormReturn['formState']['errors'];

function IdentitySection({
  form,
  errors,
  slug,
}: {
  form: FormReturn;
  errors: FieldErrors;
  slug: string;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Identitas Perusahaan"
        description="Nama tampilan dan zona waktu default untuk semua kalkulasi."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Nama Perusahaan" error={errors.name?.message}>
          <input
            {...form.register('name')}
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Slug (tidak dapat diubah)">
          <input
            value={slug}
            disabled
            className="border-input bg-muted text-muted-foreground w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>

        <Field
          label="Timezone (IANA)"
          hint="Contoh: Asia/Jakarta, Asia/Makassar, UTC. Divalidasi dengan Intl."
          error={errors.timezone?.message}
        >
          <input
            {...form.register('timezone')}
            placeholder="Asia/Jakarta"
            className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
          />
        </Field>
      </div>
    </section>
  );
}

function OvertimePolicySection({
  form,
  errors,
}: {
  form: FormReturn;
  errors: FieldErrors;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Kebijakan Lembur"
        description="Tarif dasar per jam, multiplier per klasifikasi hari, dan batasan pengajuan/proses."
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Tarif Dasar per Jam (Rp)"
          hint="Kosongkan untuk mewajibkan tarif per-karyawan (User.overtimeHourlyRate)."
          error={errors.overtimeHourlyRate?.message}
        >
          <Controller
            control={form.control}
            name="overtimeHourlyRate"
            render={({ field }) => (
              <input
                type="number"
                min={0}
                step="0.01"
                value={field.value ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  field.onChange(raw === '' ? null : Number(raw));
                }}
                placeholder="mis. 50000"
                className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
              />
            )}
          />
        </Field>

        <NumberField
          form={form}
          name="overtimeMaxHoursPerDay"
          label="Batas Jam Lembur / Hari"
          hint="1–24 jam. Pengajuan di atas nilai ini akan ditolak."
          step="0.5"
          min={0.5}
          max={24}
          error={errors.overtimeMaxHoursPerDay?.message}
        />

        <NumberField
          form={form}
          name="overtimeWeekdayMultiplier"
          label="Multiplier Hari Kerja"
          hint="Contoh: 1.5 untuk Senin–Jumat."
          step="0.1"
          min={1}
          max={10}
          error={errors.overtimeWeekdayMultiplier?.message}
        />

        <NumberField
          form={form}
          name="overtimeWeekendMultiplier"
          label="Multiplier Sabtu/Minggu"
          hint="Diterapkan jika tanggal bukan hari libur nasional."
          step="0.1"
          min={1}
          max={10}
          error={errors.overtimeWeekendMultiplier?.message}
        />

        <NumberField
          form={form}
          name="overtimeHolidayMultiplier"
          label="Multiplier Hari Libur"
          hint="Prioritas tertinggi — mengalahkan klasifikasi weekend."
          step="0.1"
          min={1}
          max={10}
          error={errors.overtimeHolidayMultiplier?.message}
        />

        <NumberField
          form={form}
          name="overtimeSubmitWindowDays"
          label="Jendela Pengajuan (hari)"
          hint="Karyawan boleh submit lembur sampai N hari ke belakang."
          step="1"
          min={1}
          max={365}
          error={errors.overtimeSubmitWindowDays?.message}
        />

        <NumberField
          form={form}
          name="overtimeCompleteGraceDays"
          label="Grace Period Scheduler (hari)"
          hint="Menunggu N hari setelah workDate sebelum scheduler mempromote APPROVED → COMPLETED."
          step="1"
          min={0}
          max={30}
          error={errors.overtimeCompleteGraceDays?.message}
        />
      </div>
    </section>
  );
}

function PayrollLockSection({
  form,
  errors,
}: {
  form: FormReturn;
  errors: FieldErrors;
}): JSX.Element {
  return (
    <section className="space-y-4">
      <SectionHeader
        title="Cutoff Payroll"
        description="Kunci periode gaji yang sudah dibayar. Setelah cutoff aktif, HR tidak bisa lagi menandai/mencabut absen pada tanggal ≤ cutoff — hanya Super Admin sebagai jalur darurat."
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Payroll Locked Until"
          hint="Inklusif — tanggal ini pun ikut terkunci. Kosongkan untuk melepas kunci."
          error={errors.payrollLockedUntil?.message}
        >
          <Controller
            control={form.control}
            name="payrollLockedUntil"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={field.value ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    field.onChange(raw === '' ? null : raw);
                  }}
                  className="border-input bg-background rounded-md border px-3 py-2 text-sm"
                />
                {field.value ? (
                  <button
                    type="button"
                    onClick={() => field.onChange(null)}
                    className="text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-xs"
                  >
                    Lepas kunci
                  </button>
                ) : null}
              </div>
            )}
          />
        </Field>
      </div>
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <p className="font-medium">Penting:</p>
        <ul className="mt-1 list-inside list-disc space-y-1">
          <li>
            <strong>Auto-absent scheduler</strong> akan melewati tanggal ≤ cutoff dengan alasan
            <code className="ml-1 rounded bg-white/70 px-1">PAYROLL_LOCKED</code>. Tidak ada
            klasifikasi otomatis pada periode yang sudah dibayar.
          </li>
          <li>
            Mundurin cutoff ke belakang <strong>tidak</strong> memicu backfill otomatis. Jika perlu
            klasifikasi ulang, jalankan trigger scanner secara manual sebagai Super Admin.
          </li>
          <li>
            Perubahan field ini masuk audit log <code>COMPANY_CONFIG_UPDATED</code>.
          </li>
        </ul>
      </div>
    </section>
  );
}

function OvertimePreview({ control }: { control: Control<FormValues> }): JSX.Element {
  // Live preview using useWatch so the numbers update as the admin drags
  // multipliers around. Purely presentational — helps intuit "if I set 2.5×
  // on weekends, what does an 8-hour Saturday actually cost?".
  const values = useWatch({ control });
  const rate = numberOrZero(values.overtimeHourlyRate);
  const wd = numberOrZero(values.overtimeWeekdayMultiplier);
  const we = numberOrZero(values.overtimeWeekendMultiplier);
  const ho = numberOrZero(values.overtimeHolidayMultiplier);
  const hours = 8;

  return (
    <section className="rounded-lg border border-dashed p-4">
      <h4 className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        Simulasi biaya 8 jam lembur
      </h4>
      <p className="text-muted-foreground mt-1 text-[11px]">
        Berdasarkan tarif dasar &amp; multiplier yang sedang diisi di form ini. Tarif per-user tidak
        diperhitungkan di preview ini.
      </p>
      {rate > 0 ? (
        <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-3">
          <PreviewRow label="Hari Kerja" mult={wd} hours={hours} rate={rate} />
          <PreviewRow label="Sabtu/Minggu" mult={we} hours={hours} rate={rate} />
          <PreviewRow label="Hari Libur" mult={ho} hours={hours} rate={rate} />
        </dl>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          Isi tarif dasar per jam untuk melihat simulasi.
        </p>
      )}
    </section>
  );
}

function PreviewRow({
  label,
  mult,
  hours,
  rate,
}: {
  label: string;
  mult: number;
  hours: number;
  rate: number;
}): JSX.Element {
  const total = mult * hours * rate;
  return (
    <div className="bg-muted/30 rounded-md border p-2">
      <dt className="text-muted-foreground text-[10px] uppercase tracking-widest">{label}</dt>
      <dd className="mt-1 font-medium tabular-nums">
        {mult.toFixed(2)}× · Rp {formatIDR(total)}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field primitives
// ---------------------------------------------------------------------------

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider">{label}</label>
      {children}
      {hint && !error && <p className="text-muted-foreground text-[11px]">{hint}</p>}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}

function NumberField({
  form,
  name,
  label,
  hint,
  step,
  min,
  max,
  error,
}: {
  form: FormReturn;
  name: keyof FormValues;
  label: string;
  hint?: string;
  step: string;
  min: number;
  max: number;
  error?: string;
}): JSX.Element {
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        {...form.register(name, { valueAsNumber: true })}
        className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm tabular-nums"
      />
    </Field>
  );
}

function SectionHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}): JSX.Element {
  return (
    <header>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground text-xs">{description}</p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatIDR(n: number): string {
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(n));
}
