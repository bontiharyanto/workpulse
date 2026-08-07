'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { overtimeRequestInputSchema, type OvertimeRequestInput } from '@workpulse/shared-types';
import { AlertTriangle, CheckCircle2, Send } from 'lucide-react';
import { useState, type JSX } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, overtimeApi } from '@/lib/api-client';

/**
 * Employee-facing form to submit an overtime request.
 *
 * INVARIANT (rules/20 §4): overtime rate math (`baseRate`,
 * `rateMultiplier`, `ratePerHour`, `totalAmount`, `dayKind`) is
 * server-computed and MUST NOT be estimated on the FE. This form
 * only collects `workDate + hours + reason` and shows the server
 * response — no cost preview here on purpose.
 *
 * The 12-hour cap in `overtimeHoursSchema` is a hard schema cap;
 * company-specific `overtimeMaxHoursPerDay` is server-enforced
 * (returns `HOURS_EXCEEDS_DAILY_CAP`). Do not bake the tenant cap
 * into the FE — surface the server error instead.
 */
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
    <Card>
      <CardHeader>
        <CardTitle>Ajukan Lembur</CardTitle>
        <p className="text-muted-foreground text-caption">
          Tarif lembur dihitung otomatis di server berdasarkan hari kerja / akhir pekan / hari
          libur.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="ot-workDate">Tanggal Lembur</Label>
            <Input id="ot-workDate" type="date" {...form.register('workDate')} />
            {form.formState.errors.workDate ? (
              <p role="alert" className="text-destructive text-caption">
                {form.formState.errors.workDate.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ot-hours">Jumlah Jam (0,25 – 12)</Label>
            <Input
              id="ot-hours"
              type="number"
              step="0.25"
              min="0.25"
              max="12"
              className="tabular-nums"
              {...form.register('hours', { valueAsNumber: true })}
            />
            {form.formState.errors.hours ? (
              <p role="alert" className="text-destructive text-caption">
                {form.formState.errors.hours.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ot-reason">Alasan</Label>
            <Textarea
              id="ot-reason"
              rows={3}
              placeholder="Deadline release / support incident / …"
              {...form.register('reason')}
            />
            {form.formState.errors.reason ? (
              <p role="alert" className="text-destructive text-caption">
                {form.formState.errors.reason.message}
              </p>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal mengajukan lembur</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {ok ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{ok}</AlertTitle>
              <AlertDescription>
                Menunggu persetujuan · notifikasi akan dikirim jika keputusan sudah dibuat.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={submit.isPending}>
            <Send className="h-4 w-4" aria-hidden />
            {submit.isPending ? 'Mengirim…' : 'Ajukan lembur'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
