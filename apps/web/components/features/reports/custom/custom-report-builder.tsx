'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import type {
  CustomReportCatalogue,
  CustomReportDefinition,
  CustomReportDimension,
  CustomReportMetric,
  CustomReportResult,
  CustomReportWindow,
  SavedReportResponse,
} from '@workpulse/shared-types';

import { ApiError, customReportAdminApi, saveBlob } from '@/lib/api-client';

/**
 * Fase 33b — DPO-facing builder for ad-hoc + saved custom reports.
 *
 * State model:
 *   `def` — current definition being previewed / persisted.
 *   `preview` — last preview result, invalidated whenever `def` changes.
 *   `selectedSavedId` — currently loaded saved report, if any.
 */
export function CustomReportBuilder(): JSX.Element {
  const qc = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);
  const [def, setDef] = useState<CustomReportDefinition>({
    dimension: 'DAY',
    metric: 'ATTENDANCE_ON_TIME_RATE',
    filter: { windowDays: 30 },
  });
  const [preview, setPreview] = useState<CustomReportResult | null>(null);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);
  const [savedName, setSavedName] = useState('');

  const catalogue = useQuery<CustomReportCatalogue>({
    queryKey: ['custom-report', 'catalogue'],
    queryFn: () => customReportAdminApi.catalogue(),
    staleTime: 5 * 60 * 1000,
  });
  const savedList = useQuery<SavedReportResponse[]>({
    queryKey: ['custom-report', 'saved-list'],
    queryFn: () => customReportAdminApi.listSaved(),
    staleTime: 30_000,
  });

  const showApiError = (err: unknown): void => {
    setBanner(err instanceof ApiError ? err.message : (err as Error).message);
  };

  const previewMut = useMutation({
    mutationFn: () => customReportAdminApi.preview(def),
    onSuccess: (r) => setPreview(r),
    onError: showApiError,
  });
  const saveMut = useMutation({
    mutationFn: () => {
      if (selectedSavedId) {
        return customReportAdminApi.updateSaved(selectedSavedId, {
          name: savedName.trim() || undefined,
          definition: def as unknown as Record<string, unknown>,
        });
      }
      return customReportAdminApi.createSaved({
        name: savedName.trim(),
        definition: def as unknown as Record<string, unknown>,
      });
    },
    onSuccess: (row) => {
      setSelectedSavedId(row.id);
      qc.invalidateQueries({ queryKey: ['custom-report', 'saved-list'] });
    },
    onError: showApiError,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => customReportAdminApi.removeSaved(id),
    onSuccess: () => {
      setSelectedSavedId(null);
      setSavedName('');
      qc.invalidateQueries({ queryKey: ['custom-report', 'saved-list'] });
    },
    onError: showApiError,
  });

  function loadSaved(row: SavedReportResponse): void {
    setSelectedSavedId(row.id);
    setSavedName(row.name);
    // Server persists definition as arbitrary JSON; trust the shape
    // (server validates on read) and cast.
    setDef(row.definition as CustomReportDefinition);
    setPreview(null);
    setBanner(null);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <aside className="space-y-4">
        <section className="border-border space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Saved reports</h3>
          <ul className="space-y-1">
            {savedList.data?.map((r) => (
              <li
                key={r.id}
                className="border-border flex items-center justify-between rounded-md border px-2 py-1 text-xs"
              >
                <button
                  type="button"
                  className={`flex-1 text-left ${r.id === selectedSavedId ? 'font-semibold' : ''}`}
                  onClick={() => loadSaved(r)}
                >
                  {r.name}
                </button>
                <button
                  type="button"
                  className="ml-2 text-[10px] text-red-700 underline"
                  onClick={() => {
                    if (confirm(`Hapus "${r.name}"?`)) removeMut.mutate(r.id);
                  }}
                >
                  hapus
                </button>
              </li>
            ))}
            {savedList.data?.length === 0 && (
              <li className="text-muted-foreground text-xs">Belum ada saved report.</li>
            )}
          </ul>
        </section>

        <section className="border-border space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Builder</h3>
          <label className="block text-xs">
            Dimension
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={def.dimension}
              onChange={(e) =>
                setDef({
                  ...def,
                  dimension: e.target.value as CustomReportDimension,
                })
              }
            >
              {catalogue.data?.dimensions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Metric
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={def.metric}
              onChange={(e) =>
                setDef({
                  ...def,
                  metric: e.target.value as CustomReportMetric,
                })
              }
            >
              {catalogue.data?.metricDescriptors.map((m) => (
                <option key={m.metric} value={m.metric}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            Window (hari)
            <select
              className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
              value={def.filter.windowDays}
              onChange={(e) =>
                setDef({
                  ...def,
                  filter: {
                    ...def.filter,
                    windowDays: Number(e.target.value) as CustomReportWindow,
                  },
                })
              }
            >
              {catalogue.data?.windows.map((w) => (
                <option key={w} value={w}>
                  {w} hari
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="bg-primary text-primary-foreground w-full rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            onClick={() => previewMut.mutate()}
            disabled={previewMut.isPending}
          >
            {previewMut.isPending ? 'Menghitung…' : 'Preview'}
          </button>
        </section>

        <section className="border-border space-y-2 rounded-md border p-3">
          <h3 className="text-sm font-semibold">Save</h3>
          <input
            type="text"
            placeholder="Nama saved report"
            className="border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm"
            value={savedName}
            onChange={(e) => setSavedName(e.target.value)}
            minLength={3}
          />
          <button
            type="button"
            className="w-full rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || savedName.trim().length < 3}
          >
            {selectedSavedId ? 'Update saved' : 'Simpan sebagai saved'}
          </button>
        </section>
      </aside>

      <main className="space-y-4">
        {banner && (
          <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
            {banner}
          </div>
        )}
        {preview ? (
          <PreviewTable preview={preview} />
        ) : (
          <div className="border-border text-muted-foreground rounded-md border border-dashed p-6 text-sm">
            Klik "Preview" untuk menjalankan definition di server dan melihat hasilnya di sini.
          </div>
        )}

        {selectedSavedId && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() =>
                customReportAdminApi
                  .exportCsv(selectedSavedId)
                  .then((b) => saveBlob(b))
                  .catch(showApiError)
              }
            >
              Export CSV
            </button>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs"
              onClick={() =>
                customReportAdminApi
                  .exportXlsx(selectedSavedId)
                  .then((b) => saveBlob(b))
                  .catch(showApiError)
              }
            >
              Export XLSX
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

function PreviewTable({ preview }: { preview: CustomReportResult }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          {preview.totalRows} rows · {preview.computedAt.slice(0, 19).replace('T', ' ')} UTC
        </span>
      </div>
      <div className="border-border overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs">
            <tr>
              <th className="px-2 py-1.5">Key</th>
              <th className="px-2 py-1.5">Label</th>
              <th className="px-2 py-1.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((r) => (
              <tr key={r.key} className="border-border border-t">
                <td className="px-2 py-1 font-mono text-xs">{r.key}</td>
                <td className="px-2 py-1">{r.label ?? '—'}</td>
                <td className="px-2 py-1 text-right font-mono">{r.value}</td>
              </tr>
            ))}
            {preview.rows.length === 0 && (
              <tr>
                <td colSpan={3} className="text-muted-foreground px-2 py-6 text-center text-xs">
                  Tidak ada data untuk kombinasi dimension × metric × window ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
