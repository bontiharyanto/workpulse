'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Employee-facing submission form for a punch correction.
 *
 * UX priorities:
 *   - Big obvious controls for "date + missing time(s)". Nothing fancier —
 *     the employee opening this page has forgotten to clock and is stressed.
 *   - Client-side pre-validation mirrors the API's `AT_LEAST_ONE_TIME` rule
 *     so a common mistake gets a friendly inline error rather than a 400.
 *   - Time inputs are `type="time"` (HH:mm) — we translate to UTC on the
 *     workDate before submitting. This is deliberate: users think in
 *     wall-clock time, not ISO.
 */
export function CorrectionForm(): JSX.Element {
  const qc = useQueryClient();

  const today = new Date().toISOString().slice(0, 10);
  const [workDate, setWorkDate] = useState<string>(today);
  const [clockIn, setClockIn] = useState<string>('');
  const [clockOut, setClockOut] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [inlineError, setInlineError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: attendanceCorrectionsApi.submit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'mine'] });
      setClockIn('');
      setClockOut('');
      setReason('');
      setInlineError(null);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setInlineError(null);
    if (!clockIn && !clockOut) {
      setInlineError('Isi minimal salah satu jam masuk atau jam pulang.');
      return;
    }
    if (reason.trim().length < 5) {
      setInlineError('Alasan minimal 5 karakter.');
      return;
    }
    const inIso = clockIn ? localTimeToUtcIso(workDate, clockIn) : null;
    const outIso = clockOut ? localTimeToUtcIso(workDate, clockOut) : null;
    submit.mutate({
      workDate,
      requestedClockInAt: inIso,
      requestedClockOutAt: outIso,
      reason: reason.trim(),
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm">
      <header className="space-y-0.5">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          Ajukan koreksi
        </p>
        <p className="text-sm font-medium">
          Isi tanggal dan jam yang seharusnya tercatat, lampirkan alasan.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Tanggal</span>
          <input
            type="date"
            value={workDate}
            max={today}
            onChange={(e) => setWorkDate(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            required
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            Jam masuk (opsional)
          </span>
          <input
            type="time"
            value={clockIn}
            onChange={(e) => setClockIn(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
          />
        </label>

        <label className="space-y-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">
            Jam pulang (opsional)
          </span>
          <input
            type="time"
            value={clockOut}
            onChange={(e) => setClockOut(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
          />
        </label>
      </div>

      <label className="block space-y-1 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Alasan</span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Contoh: lupa clock-in karena rapat pagi mendadak."
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          required
        />
      </label>

      {inlineError ? (
        <p className="text-sm text-destructive">{inlineError}</p>
      ) : null}
      {submit.isError ? (
        <p className="text-sm text-destructive">{formatApiError(submit.error)}</p>
      ) : null}
      {submit.isSuccess ? (
        <p className="text-sm text-emerald-700">
          Koreksi diajukan. Menunggu keputusan supervisor / HR.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submit.isPending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        {submit.isPending ? 'Mengirim...' : 'Kirim koreksi'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine YYYY-MM-DD + HH:mm (local wall-clock) into a UTC ISO string.
 * We interpret the input as local time, then hand off to the browser's
 * timezone offset to compute the correct UTC. Rationale: the employee
 * knows their local wall-clock — the server stores everything in UTC.
 */
function localTimeToUtcIso(workDate: string, hhmm: string): string {
  const parts = hhmm.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const [yy, mm, dd] = workDate.split('-').map(Number);
  const local = new Date(yy!, (mm ?? 1) - 1, dd ?? 1, h, m, 0, 0);
  return local.toISOString();
}

function formatApiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'PAYROLL_LOCKED') {
      return 'Periode payroll sudah ditutup — koreksi tidak dapat diajukan untuk tanggal ini.';
    }
    if (err.code === 'DUPLICATE_PENDING') {
      return 'Ada koreksi Anda yang masih PENDING untuk tanggal tersebut.';
    }
    if (err.code === 'BEFORE_HIRED_AT') {
      return 'Tanggal berada sebelum tanggal Anda bergabung.';
    }
    if (err.code === 'DATE_IN_FUTURE') {
      return 'Tanggal koreksi tidak boleh di masa depan.';
    }
    return err.message ?? err.code;
  }
  return 'Terjadi kesalahan tak dikenal.';
}
