'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, LogIn, LogOut, MapPin, Wifi } from 'lucide-react';
import { useEffect, useState, type JSX } from 'react';

import { CountUp } from '@/components/motion/motion-primitives';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, attendanceApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

import { StatusBadge } from './_shared/status-badge';

interface Coords {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

/**
 * Server-emitted error codes → localized copy. Kept a plain record
 * (not a switch) so adding a new code is a one-line change and
 * `.cursor/rules/20-security-and-business-rules.mdc` §5 is honored
 * — we never surface raw stack traces.
 */
const ERROR_COPY: Record<string, string> = {
  OUTSIDE_GEOFENCE: 'Lokasi Anda di luar area kantor. Silakan mendekat ke titik geofence.',
  ALREADY_CLOCKED_IN: 'Anda sudah clock-in untuk hari ini.',
  NOT_CLOCKED_IN: 'Anda belum clock-in hari ini.',
  SHIFT_NOT_FOUND: 'Shift Anda belum diatur. Hubungi HR.',
  FORBIDDEN: 'Anda tidak memiliki akses untuk aksi ini.',
  UNAUTHORIZED: 'Sesi Anda berakhir. Silakan login kembali.',
};

/**
 * INVARIANT — the client sends ONLY the raw `{ latitude, longitude,
 * accuracyMeters }` triple. It never computes `isInsideGeofence`,
 * `distanceMeters`, or any other pre-decision. Geofence validation
 * happens server-side via Haversine — see
 * `apps/api/src/attendance/domain/geofence.ts`.
 *
 * `enableHighAccuracy: true` + `maximumAge: 0` are required — they
 * prevent the browser from returning a stale cached position that
 * would let a user clock in from home.
 */
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
  const [message, setMessage] = useState<{
    kind: 'ok' | 'error';
    text: string;
    errorCode?: string;
  } | null>(null);

  const now = useLiveClock();

  const todayQuery = useQuery({
    queryKey: ['attendance', 'today'],
    queryFn: attendanceApi.today,
  });

  const record = todayQuery.data ?? null;
  const canClockIn = !record;
  const canClockOut = Boolean(record && !record.clockOutAt);
  const hasFinishedShift = Boolean(record?.clockOutAt);

  const clockIn = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords();
      return attendanceApi.clockIn(coords);
    },
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'Berhasil clock-in.' });
      void qc.invalidateQueries({ queryKey: ['attendance', 'today'] });
    },
    onError: (err: unknown) => setMessage(errorMessage(err)),
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
    onError: (err: unknown) => setMessage(errorMessage(err)),
  });

  const pending = clockIn.isPending || clockOut.isPending;

  return (
    <Card className="overflow-hidden">
      <div className="from-primary/10 via-primary/5 to-card border-border/50 relative border-b bg-gradient-to-br px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-muted-foreground text-overline uppercase">Waktu saat ini</p>
            <p className="text-display-sm text-foreground font-semibold tabular-nums">
              {now.toLocaleTimeString('id-ID', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </p>
            <p className="text-muted-foreground text-caption">
              {now.toLocaleDateString('id-ID', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>

          <div className="text-right">
            <p className="text-muted-foreground text-overline uppercase">Status</p>
            {todayQuery.isLoading ? (
              <Skeleton className="mt-2 h-6 w-32" />
            ) : record ? (
              <div className="mt-2 space-y-2">
                <StatusBadge
                  status={record.status}
                  labelOverride={
                    hasFinishedShift ? `${labelFromStatus(record.status)} · Selesai` : undefined
                  }
                />
                {!hasFinishedShift ? (
                  <p className="text-muted-foreground text-caption">Sedang bekerja</p>
                ) : null}
              </div>
            ) : (
              <Badge variant="muted" className="mt-2">
                <Clock className="h-3 w-3" aria-hidden />
                Belum clock-in
              </Badge>
            )}
          </div>
        </div>
      </div>

      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap gap-3">
          <Button
            size="lg"
            className="min-w-[160px]"
            disabled={!canClockIn || pending}
            onClick={() => clockIn.mutate()}
          >
            <LogIn className="h-4 w-4" aria-hidden />
            {clockIn.isPending ? 'Memproses…' : 'Clock In'}
          </Button>
          <Button
            variant="outline"
            size="lg"
            className="min-w-[160px]"
            disabled={!canClockOut || pending}
            onClick={() => clockOut.mutate()}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {clockOut.isPending ? 'Memproses…' : 'Clock Out'}
          </Button>
        </div>

        {record ? (
          <ShiftMeta record={record} />
        ) : (
          <p className="text-muted-foreground text-caption inline-flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Lokasi Anda akan diperiksa oleh server saat menekan Clock In.
          </p>
        )}

        {message ? (
          message.kind === 'error' ? (
            <Alert variant="destructive">
              {message.errorCode === 'OUTSIDE_GEOFENCE' ? (
                <MapPin aria-hidden />
              ) : (
                <Wifi aria-hidden />
              )}
              <AlertTitle>
                {message.errorCode === 'OUTSIDE_GEOFENCE'
                  ? 'Di luar area geofence'
                  : 'Tidak dapat diproses'}
              </AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          ) : (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{message.text}</AlertTitle>
              <AlertDescription>Data punch Anda tercatat.</AlertDescription>
            </Alert>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function labelFromStatus(status: string): string {
  return status === 'ON_TIME'
    ? 'Tepat waktu'
    : status === 'LATE'
      ? 'Terlambat'
      : status === 'EARLY_LEAVE'
        ? 'Pulang cepat'
        : status;
}

function errorMessage(err: unknown): { kind: 'error'; text: string; errorCode?: string } {
  if (err instanceof ApiError) {
    return { kind: 'error', text: ERROR_COPY[err.code] ?? err.message, errorCode: err.code };
  }
  if (err instanceof Error) return { kind: 'error', text: err.message };
  return { kind: 'error', text: 'Terjadi kesalahan yang tidak terduga.' };
}

interface ShiftMetaProps {
  record: {
    clockInAt: string;
    clockOutAt: string | null;
    lateMinutes: number;
    earlyLeaveMinutes: number;
  };
}

function ShiftMeta({ record }: ShiftMetaProps): JSX.Element {
  const clockIn = new Date(record.clockInAt);
  const clockOut = record.clockOutAt ? new Date(record.clockOutAt) : null;
  const workedMs = clockOut
    ? clockOut.getTime() - clockIn.getTime()
    : Date.now() - clockIn.getTime();
  const workedHours = workedMs / (1000 * 60 * 60);

  return (
    <div className="border-border bg-muted/20 grid grid-cols-1 gap-4 rounded-lg border p-4 sm:grid-cols-3">
      <ShiftMetaCell
        label="Clock In"
        value={clockIn.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
        tone={record.lateMinutes > 0 ? 'warning' : 'default'}
        subtext={record.lateMinutes > 0 ? `Terlambat ${record.lateMinutes} menit` : undefined}
      />
      <ShiftMetaCell
        label="Clock Out"
        value={
          clockOut
            ? clockOut.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
            : '—'
        }
        tone={record.earlyLeaveMinutes > 0 ? 'warning' : 'default'}
        subtext={
          record.earlyLeaveMinutes > 0
            ? `Pulang cepat ${record.earlyLeaveMinutes} menit`
            : undefined
        }
      />
      <ShiftMetaCell
        label="Durasi kerja"
        value={
          <span className="tabular-nums">
            <CountUp value={workedHours} duration={0.6} format={(v) => v.toFixed(1)} />
            <span className="text-caption text-muted-foreground ml-1">jam</span>
          </span>
        }
      />
    </div>
  );
}

function ShiftMetaCell({
  label,
  value,
  tone = 'default',
  subtext,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning';
  subtext?: string;
}): JSX.Element {
  return (
    <div>
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <p
        className={cn(
          'text-h4 tabular-nums',
          tone === 'warning' ? 'text-warning' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {subtext ? <p className="text-caption text-warning">{subtext}</p> : null}
    </div>
  );
}

/**
 * `useLiveClock` — returns the current `Date`, updated every second.
 * Kept internal to `clock-panel` because it's the only place we
 * currently need a ticking clock. Uses `setInterval` (fine for 1Hz),
 * with a self-clean-up.
 */
function useLiveClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
