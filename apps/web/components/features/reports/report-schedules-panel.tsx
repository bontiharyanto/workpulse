'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  ReportDeliveryResponse,
  ReportFrequency,
  ReportRegistryEntry,
  ReportScheduleResponse,
  ScheduledReportType,
} from '@workpulse/shared-types';

import { ApiError, reportScheduleAdminApi } from '@/lib/api-client';

const STATUS_BADGE: Record<
  ReportDeliveryResponse['status'],
  { label: string; className: string }
> = {
  PENDING: { label: 'Pending', className: 'bg-muted text-muted-foreground' },
  DISPATCHING: {
    label: 'Dispatching',
    className: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  },
  DELIVERED: {
    label: 'Delivered',
    className:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  },
  FAILED: {
    label: 'Failed',
    className: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-100',
  },
};

const FREQUENCIES: readonly ReportFrequency[] = [
  'DAILY',
  'WEEKLY',
  'MONTHLY',
];

const WEEKLY_DAYS = [
  ['Minggu', 0],
  ['Senin', 1],
  ['Selasa', 2],
  ['Rabu', 3],
  ['Kamis', 4],
  ['Jumat', 5],
  ['Sabtu', 6],
] as const;

export function ReportSchedulesPanel(): JSX.Element {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const registry = useQuery<ReportRegistryEntry[]>({
    queryKey: ['report-schedule', 'registry'],
    queryFn: () => reportScheduleAdminApi.registry(),
    staleTime: 5 * 60 * 1000,
  });
  const list = useQuery<ReportScheduleResponse[]>({
    queryKey: ['report-schedule', 'list'],
    queryFn: () => reportScheduleAdminApi.list(),
    staleTime: 30_000,
  });
  const deliveries = useQuery<ReportDeliveryResponse[]>({
    queryKey: ['report-schedule', 'deliveries', selectedId],
    queryFn: () => reportScheduleAdminApi.deliveries(selectedId!),
    enabled: !!selectedId,
    staleTime: 15_000,
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportScheduleAdminApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedule'] }),
    onError: showApiError,
  });
  const toggle = useMutation({
    mutationFn: (row: ReportScheduleResponse) =>
      reportScheduleAdminApi.update(row.id, { active: !row.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['report-schedule'] }),
    onError: showApiError,
  });

  function showApiError(err: unknown): void {
    setBanner(err instanceof ApiError ? err.message : (err as Error).message);
  }

  return (
    <div className="space-y-4">
      {banner && (
        <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {banner}
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Jadwal laporan</h2>
        <button
          type="button"
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          onClick={() => {
            setShowCreate((v) => !v);
            setBanner(null);
          }}
        >
          {showCreate ? 'Batal' : '+ Jadwal baru'}
        </button>
      </div>

      {showCreate && (
        <CreateForm
          registry={registry.data ?? []}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['report-schedule'] });
          }}
          onError={showApiError}
        />
      )}

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr>
              <th className="px-2 py-2">Nama</th>
              <th className="px-2 py-2">Report</th>
              <th className="px-2 py-2">Frekuensi</th>
              <th className="px-2 py-2">Next run (UTC)</th>
              <th className="px-2 py-2">Recipients</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-2 py-1.5 font-medium">{r.name}</td>
                <td className="px-2 py-1.5">{r.reportType}</td>
                <td className="px-2 py-1.5">
                  {r.frequency}
                  {r.cadenceDay !== null && (
                    <span className="ml-1 text-muted-foreground">
                      · d={r.cadenceDay}
                    </span>
                  )}
                  <span className="ml-1 text-muted-foreground">
                    · {r.cadenceHour}h
                  </span>
                </td>
                <td className="px-2 py-1.5 font-mono text-xs">
                  {r.nextRunAt.slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-2 py-1.5 text-xs">
                  {r.recipients.length} email
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      r.active
                        ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {r.active ? 'active' : 'paused'}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => setSelectedId(r.id)}
                    >
                      Log
                    </button>
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => toggle.mutate(r)}
                      disabled={toggle.isPending}
                    >
                      {r.active ? 'Pause' : 'Aktifkan'}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-red-700 underline"
                      onClick={() => {
                        if (confirm('Hapus jadwal ini?')) remove.mutate(r.id);
                      }}
                      disabled={remove.isPending}
                    >
                      Hapus
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {list.data && list.data.length === 0 && (
              <tr>
                <td className="px-2 py-6 text-center text-sm text-muted-foreground" colSpan={7}>
                  Belum ada jadwal. Klik "+ Jadwal baru".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selectedId && deliveries.data && (
        <section className="space-y-2 rounded-md border border-border p-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Delivery log</h3>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => setSelectedId(null)}
            >
              Tutup
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left">
                <tr>
                  <th className="px-2 py-1">Dispatched</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">SHA-256</th>
                  <th className="px-2 py-1">Bytes</th>
                  <th className="px-2 py-1">Attempts</th>
                  <th className="px-2 py-1">Error</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((d) => (
                  <tr key={d.id} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">
                      {d.createdAt.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="px-2 py-1">
                      <span
                        className={`rounded px-1.5 py-0.5 ${STATUS_BADGE[d.status].className}`}
                      >
                        {STATUS_BADGE[d.status].label}
                      </span>
                    </td>
                    <td className="px-2 py-1 font-mono">
                      {d.payloadSha256 ? `${d.payloadSha256.slice(0, 12)}…` : '—'}
                    </td>
                    <td className="px-2 py-1">{d.payloadBytes ?? '—'}</td>
                    <td className="px-2 py-1">{d.attempts}</td>
                    <td className="px-2 py-1 text-muted-foreground">
                      {d.errorSnippet ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// ---- Create form ----

function CreateForm({
  registry,
  onCreated,
  onError,
}: {
  registry: ReportRegistryEntry[];
  onCreated: () => void;
  onError: (err: unknown) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [reportType, setReportType] =
    useState<Exclude<ScheduledReportType, 'CUSTOM'>>('TIMESHEET_SUMMARY');
  const [frequency, setFrequency] = useState<ReportFrequency>('WEEKLY');
  const [cadenceDay, setCadenceDay] = useState<number>(1);
  const [cadenceHour, setCadenceHour] = useState<number>(6);
  const [recipients, setRecipients] = useState('');

  const create = useMutation({
    mutationFn: () => {
      const emails = recipients
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: {
        name: string;
        reportType: typeof reportType;
        frequency: ReportFrequency;
        cadenceHour: number;
        recipients: string[];
        cadenceDay?: number;
      } = {
        name: name.trim(),
        reportType,
        frequency,
        cadenceHour,
        recipients: emails,
      };
      if (frequency !== 'DAILY') payload.cadenceDay = cadenceDay;
      return reportScheduleAdminApi.create(payload);
    },
    onSuccess: () => {
      setName('');
      setRecipients('');
      onCreated();
    },
    onError,
  });

  return (
    <form
      className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium">Nama jadwal</label>
        <input
          type="text"
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={3}
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">Report type</label>
        <select
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={reportType}
          onChange={(e) => setReportType(e.target.value as typeof reportType)}
        >
          {registry
            .filter((r) => r.type !== 'CUSTOM')
            .map((r) => (
              <option key={r.type} value={r.type}>
                {r.label}
              </option>
            ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium">Frekuensi</label>
        <select
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as ReportFrequency)}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      {frequency === 'WEEKLY' && (
        <div>
          <label className="mb-1 block text-xs font-medium">Hari</label>
          <select
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={cadenceDay}
            onChange={(e) => setCadenceDay(Number(e.target.value))}
          >
            {WEEKLY_DAYS.map(([label, v]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      {frequency === 'MONTHLY' && (
        <div>
          <label className="mb-1 block text-xs font-medium">Tanggal (1..28)</label>
          <input
            type="number"
            min={1}
            max={28}
            value={cadenceDay || 1}
            onChange={(e) => setCadenceDay(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          />
        </div>
      )}
      <div>
        <label className="mb-1 block text-xs font-medium">
          Jam kirim (UTC, 0..23)
        </label>
        <input
          type="number"
          min={0}
          max={23}
          value={cadenceHour}
          onChange={(e) => setCadenceHour(Number(e.target.value))}
          className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </div>
      <div className="md:col-span-2">
        <label className="mb-1 block text-xs font-medium">
          Recipients (email, pisahkan koma / newline, max 20)
        </label>
        <textarea
          className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm font-mono"
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="dpo@company.com, payroll@company.com"
          required
        />
      </div>
      <div className="md:col-span-2">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={create.isPending}
        >
          {create.isPending ? 'Membuat…' : 'Buat jadwal'}
        </button>
      </div>
    </form>
  );
}
