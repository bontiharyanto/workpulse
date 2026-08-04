'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, attendanceApi } from '@/lib/api-client';
import type { ResetScannerCursorResponse } from '@workpulse/shared-types';

/**
 * SUPER_ADMIN-only tile that resets `Company.lastAbsentScanDate` and
 * optionally triggers a fresh single-tenant scan. Rendered inline on
 * the Company Config admin page — this is a rare, sharp tool.
 *
 * Guarded by a two-step confirmation (checkbox + Confirm button) so a
 * misclick can't clear the cursor. See ADR-0010 for the operational
 * context.
 */
export function ScannerCursorResetPanel(): JSX.Element | null {
  const { user } = useAuth();
  const [triggerRescan, setTriggerRescan] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ResetScannerCursorResponse | null>(null);

  const reset = useMutation({
    mutationFn: () => attendanceApi.resetScannerCursor({ triggerRescan }),
    onSuccess: (result) => {
      setError(null);
      setLastResult(result);
      setConfirmArmed(false);
    },
    onError: (err) => {
      if (err instanceof ApiError) setError(err.message);
      else setError('Gagal me-reset cursor scanner.');
    },
  });

  if (!user || user.role !== 'SUPER_ADMIN') return null;

  return (
    <section
      className="border-destructive/40 bg-destructive/5 rounded-lg border p-4"
      aria-labelledby="scanner-reset-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl">
          <h3 id="scanner-reset-heading" className="text-destructive text-sm font-semibold">
            Reset cursor auto-absent scanner
          </h3>
          <p className="text-muted-foreground mt-1 text-xs">
            Menghapus <code className="rounded bg-white/70 px-1">lastAbsentScanDate</code> sehingga
            proses berikutnya melakukan <strong>backfill</strong> hingga 30 hari ke belakang
            (kecuali tanggal terkunci payroll). Gunakan jika terjadi drift cursor setelah
            menambahkan hari libur / shift secara retroaktif.
          </p>
          <ul className="text-muted-foreground mt-2 list-inside list-disc space-y-1 text-xs">
            <li>Absensi tetap idempotent — tidak akan ada baris ganda.</li>
            <li>
              Notifikasi <code>ATTENDANCE_ABSENT_MARKED</code> <strong>bisa terkirim ulang</strong>{' '}
              untuk tanggal yang baru diklasifikasi. Konfirmasi ke tim ops dahulu.
            </li>
            <li>
              Operasi ini masuk audit log <code>SCANNER_CURSOR_RESET</code>.
            </li>
          </ul>
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={triggerRescan}
          onChange={(e) => setTriggerRescan(e.target.checked)}
          disabled={reset.isPending}
        />
        Jalankan scan ulang tenant ini setelah reset
      </label>

      <label className="mt-2 flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={confirmArmed}
          onChange={(e) => setConfirmArmed(e.target.checked)}
          disabled={reset.isPending}
        />
        Saya paham konsekuensinya (aksi destruktif, terekam di audit log)
      </label>

      <button
        type="button"
        disabled={!confirmArmed || reset.isPending}
        onClick={() => reset.mutate()}
        className="bg-destructive text-destructive-foreground mt-3 whitespace-nowrap rounded-md px-3 py-2 text-xs font-medium shadow disabled:opacity-50"
      >
        {reset.isPending ? 'Memproses…' : 'Reset cursor sekarang'}
      </button>

      {error && (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {error}
        </p>
      )}

      {lastResult && (
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
          <Metric label="Cursor sebelum" value={lastResult.before ?? '— (belum pernah)'} />
          <Metric label="Cursor sesudah" value="null" />
          <Metric label="Rescan" value={lastResult.rescanTriggered ? 'dijalankan' : '—'} />
          {lastResult.rescanResult && (
            <>
              <Metric label="Tanggal diproses" value={lastResult.rescanResult.scannedDates} />
              <Metric label="Ditandai absen" value={lastResult.rescanResult.marked} />
              <Metric label="Durasi rescan" value={`${lastResult.rescanResult.durationMs} ms`} />
            </>
          )}
        </dl>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }): JSX.Element {
  return (
    <div className="bg-background rounded-md border px-3 py-2">
      <dt className="text-muted-foreground text-[10px] uppercase tracking-widest">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
