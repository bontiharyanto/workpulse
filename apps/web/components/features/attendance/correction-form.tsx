'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PencilLine, Send } from 'lucide-react';
import { useState, type FormEvent, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, attendanceCorrectionsApi } from '@/lib/api-client';

/**
 * Employee-facing submission form for a punch correction.
 *
 * UX priorities:
 *   - Big obvious controls: someone opening this page has forgotten
 *     to clock in and is stressed. Everything must fit above the
 *     fold with no chrome.
 *   - Client pre-validation mirrors the API's `AT_LEAST_ONE_TIME`
 *     rule so common mistakes get an inline error, not a 400.
 *   - Time inputs use `type="time"` (HH:mm wall-clock) and we
 *     translate to UTC ISO on the workDate before submitting. The
 *     employee thinks in local time; the server stores in UTC.
 *
 * Note: this stays on plain `useState` rather than React Hook Form
 * for now. The form is 4 fields with straightforward validation;
 * a RHF+zod migration is worthwhile but is scoped for a later PR.
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
      void qc.invalidateQueries({ queryKey: ['attendance', 'corrections', 'mine'] });
      setClockIn('');
      setClockOut('');
      setReason('');
      setInlineError(null);
    },
  });

  function onSubmit(e: FormEvent): void {
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
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 text-primary rounded-md p-2">
            <PencilLine className="h-4 w-4" aria-hidden />
          </div>
          <div className="space-y-0.5">
            <p className="text-muted-foreground text-overline uppercase">Ajukan koreksi</p>
            <CardTitle>Ubah jam clock-in / clock-out</CardTitle>
            <p className="text-muted-foreground text-caption">
              Isi tanggal dan jam yang seharusnya tercatat, sertakan alasan.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="correction-work-date">Tanggal</Label>
              <Input
                id="correction-work-date"
                type="date"
                value={workDate}
                max={today}
                onChange={(e) => setWorkDate(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correction-clock-in">
                Jam masuk <span className="text-muted-foreground">(opsional)</span>
              </Label>
              <Input
                id="correction-clock-in"
                type="time"
                className="tabular-nums"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="correction-clock-out">
                Jam pulang <span className="text-muted-foreground">(opsional)</span>
              </Label>
              <Input
                id="correction-clock-out"
                type="time"
                className="tabular-nums"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="correction-reason">Alasan</Label>
            <Textarea
              id="correction-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Contoh: lupa clock-in karena rapat pagi mendadak."
              required
            />
            <p className="text-muted-foreground text-caption">Minimal 5 karakter · maks. 500.</p>
          </div>

          {inlineError ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Data belum lengkap</AlertTitle>
              <AlertDescription>{inlineError}</AlertDescription>
            </Alert>
          ) : null}

          {submit.isError ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal mengajukan koreksi</AlertTitle>
              <AlertDescription>{formatApiError(submit.error)}</AlertDescription>
            </Alert>
          ) : null}

          {submit.isSuccess ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertTitle>Koreksi berhasil diajukan</AlertTitle>
              <AlertDescription>Menunggu keputusan supervisor / HR.</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={submit.isPending}>
            <Send className="h-4 w-4" aria-hidden />
            {submit.isPending ? 'Mengirim…' : 'Kirim koreksi'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Combine YYYY-MM-DD + HH:mm (local wall-clock) into a UTC ISO
 * string. We interpret the input as local time, then hand off to
 * the browser's TZ offset to compute UTC. Rationale: employees
 * think in local wall-clock; the server stores everything in UTC.
 */
function localTimeToUtcIso(workDate: string, hhmm: string): string {
  const parts = hhmm.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const [yy, mm, dd] = workDate.split('-').map(Number);
  const local = new Date(yy ?? Number.NaN, (mm ?? 1) - 1, dd ?? 1, h, m, 0, 0);
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
