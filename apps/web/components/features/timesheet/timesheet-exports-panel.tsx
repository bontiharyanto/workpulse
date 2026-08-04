'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  ExportShareRow,
  ExportTimesheetInput,
  TimesheetExportFormat,
  TimesheetExportMode,
} from '@workpulse/shared-types';

import {
  ApiError,
  saveBlob,
  timesheetAdminApi,
  timesheetExportApi,
} from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  EXPORT_EMPTY:
    'Tidak ada timesheet APPROVED pada periode & filter tersebut.',
  TIMESHEET_PERIOD_NOT_FOUND: 'Periode tidak ditemukan.',
  DEPARTMENT_NOT_FOUND: 'Departemen tidak valid.',
  THROTTLED: 'Terlalu banyak percobaan export. Coba lagi sebentar.',
  SHARE_TTL_OUT_OF_RANGE: 'TTL harus 1..168 jam.',
  EXPORT_PAYLOAD_UNAVAILABLE:
    'File export ini sudah tidak dapat dibagikan (dibuat sebelum fitur signed URL). Buat export baru.',
  EXPORT_NOT_FOUND: 'Export tidak ditemukan.',
  SHARE_NOT_FOUND: 'Link tidak ditemukan.',
};

/**
 * `/admin/timesheet/exports` panel (Fase 32c).
 *
 * - Left card: form to trigger a new export (CSV / XLSX × SUMMARY / DETAIL).
 * - Right list: last 50 audit rows with the SHA-256 preview.
 *
 * The panel is intentionally standalone (no side navigation state) so
 * HR can bookmark it during payroll days.
 */
export function TimesheetExportsPanel(): JSX.Element {
  const qc = useQueryClient();

  const periods = useQuery({
    queryKey: ['timesheet-periods'],
    queryFn: () => timesheetAdminApi.periods(),
    staleTime: 30_000,
  });
  const auditRows = useQuery({
    queryKey: ['timesheet-exports-list'],
    queryFn: () => timesheetExportApi.list(50),
  });

  const [form, setForm] = useState<ExportTimesheetInput>({
    periodId: '',
    format: 'XLSX',
    mode: 'SUMMARY',
    departmentId: null,
    note: '',
  });

  const runExport = useMutation({
    mutationFn: async () => {
      const result = await timesheetExportApi.create({
        ...form,
        note: form.note?.trim() ? form.note.trim() : null,
        departmentId: form.departmentId || null,
      });
      saveBlob(result);
      return result;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet-exports-list'] });
    },
  });

  const inlineError = useMemo(() => {
    if (!runExport.error) return null;
    if (runExport.error instanceof ApiError) {
      return ERROR_COPY[runExport.error.code] ?? runExport.error.message;
    }
    return 'Gagal export timesheet.';
  }, [runExport.error]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Export payroll</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Hanya timesheet berstatus <span className="font-medium">APPROVED</span>{' '}
          yang akan diekspor. Setiap ekspor tercatat pada audit trail.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block text-sm">
            <span className="font-medium">Periode</span>
            <select
              value={form.periodId}
              onChange={(e) =>
                setForm((f) => ({ ...f, periodId: e.target.value }))
              }
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              required
              data-testid="ts-export-period"
            >
              <option value="">— Pilih periode —</option>
              {(periods.data?.items ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.periodStart} → {p.periodEnd})
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Format</span>
              <select
                value={form.format}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    format: e.target.value as TimesheetExportFormat,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="ts-export-format"
              >
                <option value="XLSX">Excel (XLSX)</option>
                <option value="CSV">CSV (RFC-4180, BOM)</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium">Mode</span>
              <select
                value={form.mode}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    mode: e.target.value as TimesheetExportMode,
                  }))
                }
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                data-testid="ts-export-mode"
              >
                <option value="SUMMARY">Summary (1 baris / user)</option>
                <option value="DETAIL">Detail (1 baris / hari)</option>
              </select>
            </label>
          </div>

          <label className="block text-sm">
            <span className="font-medium">Catatan (opsional)</span>
            <input
              type="text"
              maxLength={200}
              value={form.note ?? ''}
              onChange={(e) =>
                setForm((f) => ({ ...f, note: e.target.value }))
              }
              placeholder="mis. Payroll batch Agustus"
              className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </label>

          <button
            type="button"
            onClick={() => runExport.mutate()}
            disabled={!form.periodId || runExport.isPending}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="ts-export-submit"
          >
            {runExport.isPending ? 'Mengirim…' : 'Export & download'}
          </button>

          {inlineError && (
            <p
              role="alert"
              className="mt-2 text-sm text-destructive"
              data-testid="ts-export-error"
            >
              {inlineError}
            </p>
          )}
          {runExport.isSuccess && (
            <p className="mt-2 text-xs text-emerald-700">
              Berhasil — file diunduh & audit log tercatat.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h2 className="text-lg font-semibold">Riwayat export</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Audit trail append-only. Klik <span className="font-medium">Bagikan</span>{' '}
          untuk membuat link download 24 jam yang bisa dikirim ke vendor payroll
          tanpa perlu akun.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2 text-left">Waktu</th>
                <th className="px-2 py-2 text-left">Periode</th>
                <th className="px-2 py-2 text-left">Format / Mode</th>
                <th className="px-2 py-2 text-right">Rows</th>
                <th className="px-2 py-2 text-right">Bytes</th>
                <th className="px-2 py-2 text-left">Oleh</th>
                <th className="px-2 py-2 text-left">SHA-256</th>
                <th className="px-2 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(auditRows.data?.items ?? []).map((r) => (
                <ExportRow key={r.id} row={r} />
              ))}
              {(auditRows.data?.items ?? []).length === 0 && !auditRows.isLoading && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-2 py-6 text-center text-sm text-muted-foreground"
                  >
                    Belum ada export. Buat export pertama di panel sebelah kiri.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Export row + Share modal (Fase 32d)
// ---------------------------------------------------------------------------

type ExportRowProps = {
  row: {
    id: string;
    createdAt: string;
    period: { label: string; periodStart: string; periodEnd: string };
    format: string;
    mode: string;
    rowCount: number;
    entryCount: number;
    bytes: number;
    requestedBy: { fullName: string; email: string };
    payloadSha256: string;
  };
};

function ExportRow({ row: r }: ExportRowProps): JSX.Element {
  const [shareOpen, setShareOpen] = useState(false);
  return (
    <>
      <tr className="border-b last:border-b-0">
        <td className="px-2 py-2 font-mono text-xs">
          {r.createdAt.replace('T', ' ').slice(0, 19)}
        </td>
        <td className="px-2 py-2 text-xs">
          <div>{r.period.label}</div>
          <div className="text-[10px] text-muted-foreground">
            {r.period.periodStart} → {r.period.periodEnd}
          </div>
        </td>
        <td className="px-2 py-2 text-xs">
          <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
            {r.format}
          </span>
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 font-medium">
            {r.mode}
          </span>
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs">
          {r.rowCount}
          {r.mode === 'DETAIL' ? ` · ${r.entryCount}` : ''}
        </td>
        <td className="px-2 py-2 text-right font-mono text-xs">
          {formatBytes(r.bytes)}
        </td>
        <td className="px-2 py-2 text-xs">
          <div>{r.requestedBy.fullName}</div>
          <div className="text-[10px] text-muted-foreground">
            {r.requestedBy.email}
          </div>
        </td>
        <td className="px-2 py-2 font-mono text-[10px] text-muted-foreground">
          {r.payloadSha256.slice(0, 16)}…
        </td>
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="rounded-md border border-input bg-background px-2.5 py-1 text-xs font-medium hover:bg-accent"
            data-testid={`ts-share-${r.id}`}
          >
            Bagikan
          </button>
        </td>
      </tr>
      {shareOpen && (
        <ShareDialog exportId={r.id} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}

function ShareDialog({
  exportId,
  onClose,
}: {
  exportId: string;
  onClose: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [note, setNote] = useState<string>('');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ['timesheet-export-shares', exportId],
    queryFn: () => timesheetExportApi.listShares(exportId),
  });

  const createShare = useMutation({
    mutationFn: () =>
      timesheetExportApi.createShare(exportId, {
        ttlHours,
        note: note.trim() || null,
      }),
    onSuccess: async (data) => {
      setFreshUrl(data.url);
      setNote('');
      await qc.invalidateQueries({
        queryKey: ['timesheet-export-shares', exportId],
      });
    },
  });

  const revokeShare = useMutation({
    mutationFn: (shareId: string) =>
      timesheetExportApi.revokeShare(exportId, shareId),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ['timesheet-export-shares', exportId],
      });
    },
  });

  const createError = useMemo(() => {
    if (!createShare.error) return null;
    if (createShare.error instanceof ApiError) {
      return ERROR_COPY[createShare.error.code] ?? createShare.error.message;
    }
    return 'Gagal membuat link.';
  }, [createShare.error]);

  const copyToClipboard = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      /* Ignored — user will fall back to manual copy. */
    }
  };

  return (
    <tr>
      <td colSpan={8} className="bg-muted/30 px-4 py-4">
        <div className="rounded-md border border-border bg-background p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Bagikan link download</h3>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-muted-foreground hover:text-foreground"
              aria-label="Tutup"
            >
              Tutup
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-[100px_1fr_auto]">
            <label className="block text-xs">
              <span className="font-medium">TTL (jam)</span>
              <input
                type="number"
                min={1}
                max={168}
                value={ttlHours}
                onChange={(e) => setTtlHours(Number(e.target.value))}
                className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                data-testid={`ts-share-ttl-${exportId}`}
              />
            </label>
            <label className="block text-xs">
              <span className="font-medium">Catatan (opsional)</span>
              <input
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="mis. shared dengan Vendor A"
                className="mt-1 block w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={() => createShare.mutate()}
              disabled={createShare.isPending}
              className="self-end rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              data-testid={`ts-share-create-${exportId}`}
            >
              {createShare.isPending ? 'Membuat…' : 'Buat link'}
            </button>
          </div>

          {createError && (
            <p
              role="alert"
              className="mt-3 text-xs text-destructive"
              data-testid={`ts-share-error-${exportId}`}
            >
              {createError}
            </p>
          )}

          {freshUrl && (
            <div
              className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3"
              data-testid={`ts-share-fresh-${exportId}`}
            >
              <p className="text-xs font-medium text-emerald-900">
                Link berhasil dibuat — bagikan segera ke vendor:
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-white px-2 py-1 text-[11px] text-emerald-900">
                  {freshUrl}
                </code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(freshUrl)}
                  className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                >
                  Salin
                </button>
              </div>
            </div>
          )}

          <h4 className="mt-5 mb-2 text-xs font-semibold uppercase text-muted-foreground">
            Riwayat link
          </h4>
          {shares.isLoading ? (
            <p className="text-xs text-muted-foreground">Memuat…</p>
          ) : (shares.data?.items ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Belum ada link untuk export ini.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {(shares.data?.items ?? []).map((s) => (
                <ShareRow
                  key={s.id}
                  share={s}
                  onRevoke={() => revokeShare.mutate(s.id)}
                  revoking={revokeShare.isPending}
                />
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  );
}

function ShareRow({
  share,
  onRevoke,
  revoking,
}: {
  share: ExportShareRow;
  onRevoke: () => void;
  revoking: boolean;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
      <div>
        <div className="font-medium">
          {share.active ? (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-900">
              Aktif
            </span>
          ) : share.revokedAt ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">
              Dicabut
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
              Expired
            </span>
          )}
          <span className="ml-2 text-muted-foreground">
            Kadaluarsa {share.expiresAt.replace('T', ' ').slice(0, 16)}
          </span>
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground">
          Dibuat {share.createdAt.replace('T', ' ').slice(0, 16)} oleh{' '}
          {share.createdBy.email} · {share.downloadCount} unduhan
          {share.note ? ` · "${share.note}"` : ''}
        </div>
      </div>
      {share.active && (
        <button
          type="button"
          onClick={onRevoke}
          disabled={revoking}
          className="rounded-md border border-destructive/40 px-2 py-1 text-[10px] font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50"
          data-testid={`ts-share-revoke-${share.id}`}
        >
          Cabut
        </button>
      )}
    </li>
  );
}
