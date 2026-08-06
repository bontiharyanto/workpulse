'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  timesheetConfigBounds,
  updateTimesheetConfigInputSchema,
  type UpdateTimesheetConfigInput,
} from '@workpulse/shared-types';
import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
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
    mutationFn: (input: UpdateTimesheetConfigInput) => timesheetConfigApi.update(input),
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
      <Card aria-live="polite" role="status">
        <CardHeader>
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-4 w-full max-w-lg" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (config.isError || !config.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Gagal memuat konfigurasi. Coba muat ulang halaman.</AlertDescription>
      </Alert>
    );
  }

  return (
    <form onSubmit={onSubmit} aria-labelledby="tsc-heading">
      <Card>
        <CardHeader>
          <CardTitle id="tsc-heading">Konfigurasi timesheet</CardTitle>
          <CardDescription>
            Tentukan jenis periode dan zona waktu tenant. Perubahan berlaku pada generate timesheet
            berikutnya.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="periodType">Jenis periode</Label>
              <Controller
                control={form.control}
                name="periodType"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="periodType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="WEEKLY">Mingguan (7 hari)</SelectItem>
                      <SelectItem value="BIWEEKLY">Dua-mingguan (14 hari)</SelectItem>
                      <SelectItem value="MONTHLY">Bulanan (kalender)</SelectItem>
                      <SelectItem value="CUTOFF">Cutoff harian</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>

            {periodType === 'WEEKLY' ? (
              <div className="space-y-2">
                <Label htmlFor="weekStartDay">Hari awal minggu</Label>
                <Controller
                  control={form.control}
                  name="weekStartDay"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="weekStartDay">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MONDAY">Senin</SelectItem>
                        <SelectItem value="SUNDAY">Minggu</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            ) : null}

            {periodType === 'BIWEEKLY' ? (
              <div className="space-y-2">
                <Label htmlFor="biweeklyAnchor">Anchor bi-weekly (tanggal referensi)</Label>
                <Input id="biweeklyAnchor" type="date" {...form.register('biweeklyAnchor')} />
                <p className="text-muted-foreground text-caption">
                  Setiap periode 14 hari dihitung dari tanggal ini. Opsional — kalau kosong sistem
                  pakai anchor default.
                </p>
              </div>
            ) : null}

            {periodType === 'CUTOFF' ? (
              <div className="space-y-2">
                <Label htmlFor="cutoffDayOfMonth">Tanggal cutoff bulanan (1–28)</Label>
                <Input
                  id="cutoffDayOfMonth"
                  type="number"
                  min={timesheetConfigBounds.cutoffDayOfMonth.min}
                  max={timesheetConfigBounds.cutoffDayOfMonth.max}
                  {...form.register('cutoffDayOfMonth', { valueAsNumber: true })}
                />
                <p className="text-muted-foreground text-caption">
                  Contoh: 25 → periode 26 bulan lalu s/d 25 bulan ini.
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="timezone">Zona waktu</Label>
              <Input id="timezone" type="text" {...form.register('timezone')} />
              <p className="text-muted-foreground text-caption">
                IANA timezone, e.g. <code>Asia/Jakarta</code>.
              </p>
            </div>
          </div>

          <Separator />

          <fieldset className="space-y-4">
            <legend className="text-foreground text-body font-semibold">
              Otomasi &amp; pengingat
            </legend>
            <p className="text-muted-foreground text-caption">
              Scheduler harian menjalankan tugas ini pada 03:00 UTC (~10:00 WIB) untuk setiap
              tenant.
            </p>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="autoGenerateEnabled">Auto-generate periode berikutnya</Label>
                <p className="text-muted-foreground text-caption">
                  Saat periode ditutup, sistem otomatis membuat periode &amp; DRAFT timesheet untuk
                  setiap karyawan aktif.
                </p>
              </div>
              <Switch
                id="autoGenerateEnabled"
                checked={form.watch('autoGenerateEnabled')}
                onCheckedChange={(checked) =>
                  form.setValue('autoGenerateEnabled', checked, { shouldDirty: true })
                }
              />
            </div>

            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="reminderEnabled">Kirim reminder otomatis</Label>
                <p className="text-muted-foreground text-caption">
                  Karyawan yang belum submit &amp; approver yang menunda review akan dinotifikasi
                  setiap hari selama window di bawah.
                </p>
              </div>
              <Switch
                id="reminderEnabled"
                checked={form.watch('reminderEnabled')}
                onCheckedChange={(checked) =>
                  form.setValue('reminderEnabled', checked, { shouldDirty: true })
                }
              />
            </div>

            <div className="grid gap-4 pt-2 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="submitStart">Submit reminder mulai (hari ke-)</Label>
                <Input
                  id="submitStart"
                  type="number"
                  min={timesheetConfigBounds.submitReminderStartDays.min}
                  max={timesheetConfigBounds.submitReminderStartDays.max}
                  {...form.register('submitReminderStartDays', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="submitMax">Submit reminder berhenti (hari ke-)</Label>
                <Input
                  id="submitMax"
                  type="number"
                  min={timesheetConfigBounds.submitReminderMaxDays.min}
                  max={timesheetConfigBounds.submitReminderMaxDays.max}
                  {...form.register('submitReminderMaxDays', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="approvalStart">Approval reminder mulai (hari ke-)</Label>
                <Input
                  id="approvalStart"
                  type="number"
                  min={timesheetConfigBounds.approvalReminderStartDays.min}
                  max={timesheetConfigBounds.approvalReminderStartDays.max}
                  {...form.register('approvalReminderStartDays', { valueAsNumber: true })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="approvalMax">Approval reminder berhenti (hari ke-)</Label>
                <Input
                  id="approvalMax"
                  type="number"
                  min={timesheetConfigBounds.approvalReminderMaxDays.min}
                  max={timesheetConfigBounds.approvalReminderMaxDays.max}
                  {...form.register('approvalReminderMaxDays', { valueAsNumber: true })}
                />
              </div>
            </div>
            <p className="text-muted-foreground text-caption">
              Range: 0..30 (mulai) / 1..60 (berhenti). Nilai &ldquo;berhenti&rdquo; harus &gt;=
              &ldquo;mulai&rdquo;.
            </p>
          </fieldset>

          {inlineError ? (
            <Alert variant="destructive">
              <AlertDescription>{inlineError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p role="status" aria-live="polite" className="text-muted-foreground text-caption">
              {saved === 'saved' ? 'Perubahan tersimpan.' : ''}
            </p>
            <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
              {mutation.isPending ? 'Menyimpan…' : 'Simpan konfigurasi'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
