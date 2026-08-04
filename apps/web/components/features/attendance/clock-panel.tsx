'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ApiError, attendanceApi } from '@/lib/api-client';

interface Coords {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

const ERROR_COPY: Record<string, string> = {
  OUTSIDE_GEOFENCE: 'Lokasi Anda di luar area kantor. Silakan mendekat ke titik geofence.',
  ALREADY_CLOCKED_IN: 'Anda sudah clock-in untuk hari ini.',
  NOT_CLOCKED_IN: 'Anda belum clock-in hari ini.',
  SHIFT_NOT_FOUND: 'Shift Anda belum diatur. Hubungi HR.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk aksi ini.',
  UNAUTHORIZED: 'Sesi Anda berakhir. Silakan login kembali.',
};

function getCurrentCoords(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('Perangkat Anda tidak mendukung geolokasi.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: Math.round(pos.coords.accuracy ?? 0),
        }),
      (err) => reject(new Error(err.message)),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
    );
  });
}

export function ClockPanel(): JSX.Element {
  const qc = useQueryClient();
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const todayQuery = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: attendanceApi.today,
  });

  const record = todayQuery.data;
  const canClockIn = !record;
  const canClockOut = Boolean(record && !record.clockOutAt);

  const clockIn = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords();
      return attendanceApi.clockIn(coords);
    },
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Berhasil clock-in.' });
      void qc.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
    onError: (err: unknown) => setMessage({ kind: 'error', text: friendlyError(err) }),
  });

  const clockOut = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords();
      return attendanceApi.clockOut(coords);
    },
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Berhasil clock-out.' });
      void qc.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
    onError: (err: unknown) => setMessage({ kind: 'error', text: friendlyError(err) }),
  });

  return (
    <section className="space-y-4 rounded-lg border p-6 shadow-sm">
      <header className="flex items-center justify-between">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs uppercase tracking-widest">Status hari ini</p>
          <p className="text-lg font-medium">
            {todayQuery.isLoading
              ? 'Memuat...'
              : record
                ? statusLabel(record.status, Boolean(record.clockOutAt))
                : 'Belum clock-in'}
          </p>
          {record ? <TimingBadges record={record} /> : null}
        </div>
      </header>

      <div className="flex gap-3">
        <button
          type="button"
          disabled={!canClockIn || clockIn.isPending}
          onClick={() => clockIn.mutate()}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {clockIn.isPending ? 'Memproses...' : 'Clock In'}
        </button>
        <button
          type="button"
          disabled={!canClockOut || clockOut.isPending}
          onClick={() => clockOut.mutate()}
          className="border-input rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {clockOut.isPending ? 'Memproses...' : 'Clock Out'}
        </button>
      </div>

      {message && (
        <p
          role="status"
          className={
            message.kind === 'ok' ? 'text-sm text-emerald-600' : 'text-destructive text-sm'
          }
        >
          {message.text}
        </p>
      )}
    </section>
  );
}

function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    return ERROR_COPY[err.code] ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Terjadi kesalahan yang tidak terduga.';
}

/**
 * Prefer a friendly Indonesian label over the raw enum. Also encodes whether
 * the shift is finished — the server-side status doesn't distinguish
 * "clocked out on time" from "clocked in and still working", so we compute
 * that here from `clockOutAt`.
 */
function statusLabel(status: string, hasClockedOut: boolean): string {
  const base =
    status === 'ON_TIME'
      ? 'Tepat waktu'
      : status === 'LATE'
        ? 'Terlambat'
        : status === 'EARLY_LEAVE'
          ? 'Pulang cepat'
          : status;
  return `${base}${hasClockedOut ? ' (selesai)' : ' (sedang bekerja)'}`;
}

interface TimingBadgesProps {
  record: {
    lateMinutes: number;
    earlyLeaveMinutes: number;
  };
}

/**
 * Small inline pills that surface the numeric lateness / early-departure
 * so the user knows *how* late they were, not just that they were. Hidden
 * entirely when both fields are zero to avoid clutter for on-time days.
 */
function TimingBadges({ record }: TimingBadgesProps): JSX.Element | null {
  if (record.lateMinutes === 0 && record.earlyLeaveMinutes === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {record.lateMinutes > 0 ? (
        <span className="bg-destructive/10 text-destructive rounded-full px-2 py-0.5 font-medium">
          Terlambat {record.lateMinutes} menit
        </span>
      ) : null}
      {record.earlyLeaveMinutes > 0 ? (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          Pulang cepat {record.earlyLeaveMinutes} menit
        </span>
      ) : null}
    </div>
  );
}
