'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  WebhookEndpointRow,
  WebhookEventType,
} from '@workpulse/shared-types';

import { ApiError, webhookApi } from '@/lib/api-client';

const ALL_EVENTS: WebhookEventType[] = [
  'TIMESHEET_EXPORT_CREATED',
  'TIMESHEET_EXPORT_SHARE_CREATED',
  'TIMESHEET_REOPENED',
];

const EVENT_LABEL: Record<WebhookEventType, string> = {
  TIMESHEET_EXPORT_CREATED: 'timesheet.export.created',
  TIMESHEET_EXPORT_SHARE_CREATED: 'timesheet.export.share.created',
  TIMESHEET_REOPENED: 'timesheet.reopened',
};

const ERROR_COPY: Record<string, string> = {
  WEBHOOK_URL_REJECTED: 'URL webhook ditolak (invalid / private IP / http di prod).',
  EVENTS_EMPTY: 'Pilih minimal satu event.',
  WEBHOOK_NOT_FOUND: 'Webhook tidak ditemukan.',
  FORBIDDEN: 'Anda tidak memiliki izin untuk aksi ini.',
};

export function WebhooksPanel(): JSX.Element {
  const list = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => webhookApi.list(),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_1fr]">
      <CreateWebhookForm />

      <section className="space-y-6">
        <div className="rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-semibold">Endpoint terdaftar</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Rahasia HMAC hanya ditampilkan sekali saat pembuatan / rotasi.
            Simpan segera di sisi vendor — tidak dapat diambil kembali.
          </p>

          <div className="mt-4 space-y-3">
            {list.isLoading && (
              <p className="text-sm text-muted-foreground">Memuat…</p>
            )}
            {(list.data?.items ?? []).length === 0 && !list.isLoading && (
              <p className="text-sm text-muted-foreground">
                Belum ada endpoint. Buat di kolom sebelah kiri.
              </p>
            )}
            {(list.data?.items ?? []).map((row) => (
              <EndpointCard key={row.id} row={row} />
            ))}
          </div>
        </div>

        <DeliveryLogPanel />
      </section>
    </div>
  );
}

function CreateWebhookForm(): JSX.Element {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([
    'TIMESHEET_EXPORT_CREATED',
    'TIMESHEET_EXPORT_SHARE_CREATED',
  ]);
  const [freshSecret, setFreshSecret] = useState<
    { url: string; secret: string } | null
  >(null);

  const create = useMutation({
    mutationFn: () =>
      webhookApi.create({
        url: url.trim(),
        description: description.trim() || null,
        events,
      }),
    onSuccess: async (data) => {
      setFreshSecret({ url: data.url, secret: data.secret });
      setUrl('');
      setDescription('');
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const createError = useMemo(() => {
    if (!create.error) return null;
    if (create.error instanceof ApiError) {
      return ERROR_COPY[create.error.code] ?? create.error.message;
    }
    return 'Gagal membuat webhook.';
  }, [create.error]);

  return (
    <section className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Buat endpoint baru</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Vendor menerima POST JSON dengan header{' '}
        <span className="font-mono text-xs">X-Workpulse-Signature</span>.
      </p>

      <div className="mt-4 space-y-3">
        <label className="block text-xs">
          <span className="font-medium">URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://payroll.vendor.example/hooks/workpulse"
            className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
            data-testid="wh-form-url"
          />
        </label>
        <label className="block text-xs">
          <span className="font-medium">Deskripsi (opsional)</span>
          <input
            type="text"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="mis. Payroll Vendor A"
            className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
        </label>
        <fieldset className="text-xs">
          <legend className="font-medium">Event</legend>
          <div className="mt-1 space-y-1">
            {ALL_EVENTS.map((ev) => (
              <label key={ev} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents((prev) =>
                      e.target.checked
                        ? [...prev, ev]
                        : prev.filter((x) => x !== ev),
                    )
                  }
                  data-testid={`wh-form-event-${ev}`}
                />
                <span className="font-mono">{EVENT_LABEL[ev]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          type="button"
          onClick={() => create.mutate()}
          disabled={
            create.isPending || url.trim().length === 0 || events.length === 0
          }
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          data-testid="wh-form-submit"
        >
          {create.isPending ? 'Membuat…' : 'Buat endpoint'}
        </button>

        {createError && (
          <p
            role="alert"
            className="text-xs text-destructive"
            data-testid="wh-form-error"
          >
            {createError}
          </p>
        )}

        {freshSecret && (
          <div
            className="rounded-md border border-emerald-200 bg-emerald-50 p-3"
            data-testid="wh-fresh-secret"
          >
            <p className="text-xs font-medium text-emerald-900">
              Endpoint dibuat. Salin secret berikut ke sistem vendor sekarang —
              tidak akan ditampilkan lagi:
            </p>
            <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-[11px] text-emerald-900">
              {freshSecret.secret}
            </code>
          </div>
        )}
      </div>
    </section>
  );
}

function EndpointCard({ row }: { row: WebhookEndpointRow }): JSX.Element {
  const qc = useQueryClient();
  const [rotated, setRotated] = useState<string | null>(null);

  const testFire = useMutation({
    mutationFn: () => webhookApi.testFire(row.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['webhook-deliveries'] });
    },
  });

  const rotate = useMutation({
    mutationFn: () => webhookApi.rotateSecret(row.id),
    onSuccess: async (data) => {
      setRotated(data.secret);
    },
  });

  const remove = useMutation({
    mutationFn: () => webhookApi.remove(row.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: () => webhookApi.update(row.id, { active: !row.active }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                row.active
                  ? 'bg-emerald-100 text-emerald-900'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {row.active ? 'Aktif' : 'Nonaktif'}
            </span>
            <code className="truncate text-xs font-mono">{row.url}</code>
          </div>
          {row.description && (
            <p className="mt-1 text-xs text-muted-foreground">
              {row.description}
            </p>
          )}
          <div className="mt-1 flex flex-wrap gap-1">
            {row.events.map((ev) => (
              <span
                key={ev}
                className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-mono"
              >
                {EVENT_LABEL[ev as WebhookEventType]}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Terakhir sukses:{' '}
            {row.lastSuccessAt
              ? row.lastSuccessAt.replace('T', ' ').slice(0, 16)
              : '—'}{' '}
            · Kegagalan berturut-turut: {row.consecutiveFailures}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => testFire.mutate()}
            disabled={testFire.isPending}
            className="rounded-md border border-input bg-background px-2 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
            data-testid={`wh-test-${row.id}`}
          >
            Test-fire
          </button>
          <button
            type="button"
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
            className="rounded-md border border-input bg-background px-2 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
          >
            Rotasi secret
          </button>
          <button
            type="button"
            onClick={() => toggleActive.mutate()}
            disabled={toggleActive.isPending}
            className="rounded-md border border-input bg-background px-2 py-1 text-[10px] font-medium hover:bg-accent disabled:opacity-50"
          >
            {row.active ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm('Hapus endpoint ini? Delivery log akan ikut hilang.')) {
                remove.mutate();
              }
            }}
            disabled={remove.isPending}
            className="rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
          >
            Hapus
          </button>
        </div>
      </div>
      {rotated && (
        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px]">
          <p className="font-medium text-emerald-900">Secret baru:</p>
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-emerald-900">
            {rotated}
          </code>
        </div>
      )}
    </div>
  );
}

function DeliveryLogPanel(): JSX.Element {
  const deliveries = useQuery({
    queryKey: ['webhook-deliveries'],
    queryFn: () => webhookApi.deliveries(),
    refetchInterval: 5_000,
  });

  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <h2 className="text-lg font-semibold">Riwayat delivery</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        50 delivery terbaru. Retry mengikuti jadwal 30s → 5m → 30m → 6h
        sebelum ditandai FAILED.
      </p>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2 text-left">Waktu</th>
              <th className="px-2 py-2 text-left">Event</th>
              <th className="px-2 py-2 text-left">Status</th>
              <th className="px-2 py-2 text-right">Attempts</th>
              <th className="px-2 py-2 text-left">Response</th>
              <th className="px-2 py-2 text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {(deliveries.data?.items ?? []).map((d) => (
              <tr key={d.id} className="border-b last:border-b-0">
                <td className="px-2 py-2 font-mono text-xs">
                  {d.createdAt.replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-2 py-2 font-mono text-xs">
                  {EVENT_LABEL[d.eventType as WebhookEventType]}
                </td>
                <td className="px-2 py-2 text-xs">
                  <StatusBadge status={d.status} />
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs">
                  {d.attemptCount}
                </td>
                <td className="px-2 py-2 font-mono text-xs">
                  {d.lastResponseStatus ?? '—'}
                </td>
                <td className="px-2 py-2 text-[10px] text-destructive">
                  {d.lastError ? d.lastError.slice(0, 60) : ''}
                </td>
              </tr>
            ))}
            {(deliveries.data?.items ?? []).length === 0 && !deliveries.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-2 py-6 text-center text-sm text-muted-foreground"
                >
                  Belum ada delivery.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  if (status === 'SUCCEEDED') {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">
        SUCCEEDED
      </span>
    );
  }
  if (status === 'PENDING') {
    return (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">
        PENDING
      </span>
    );
  }
  return (
    <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
      FAILED
    </span>
  );
}
