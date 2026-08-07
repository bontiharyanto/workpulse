'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateGeofenceInput, Geofence } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, geofencesAdminApi } from '@/lib/api-client';

import { GeofenceForm } from './geofence-form';

const ERROR_COPY: Record<string, string> = {
  GEOFENCE_IN_USE_BY_SHIFT:
    'Tidak bisa dihapus: masih dipakai oleh Shift. Lepaskan dari Shift terkait terlebih dahulu.',
  GEOFENCE_NOT_FOUND: 'Geofence tidak ditemukan.',
  FORBIDDEN: 'Anda tidak memiliki akses.',
};

export function GeofenceAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState<Geofence | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'geofences'],
    queryFn: () => geofencesAdminApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (v: CreateGeofenceInput) => geofencesAdminApi.create(v),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'geofences'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: CreateGeofenceInput }) =>
      geofencesAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'geofences'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => geofencesAdminApi.remove(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'geofences'] });
    },
    onError: mapError,
  });

  function mapError(err: unknown): void {
    if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) setErrorText(err.message);
  }

  const rows = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Geofence</h2>
          <p className="text-muted-foreground text-xs">
            Titik lokasi kantor beserta radius yang divalidasi server saat clock-in/out.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium"
        >
          + Tambah
        </button>
      </div>

      {errorText && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorText}
        </p>
      )}

      {editing && (
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">
            {editing === 'new' ? 'Tambah Geofence' : `Edit: ${editing.name}`}
          </p>
          <GeofenceForm
            initial={editing === 'new' ? null : editing}
            submitting={createMut.isPending || updateMut.isPending}
            onSubmit={(values) => {
              if (editing === 'new') createMut.mutate(values);
              else updateMut.mutate({ id: editing.id, input: values });
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Belum ada geofence.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-right">Latitude</th>
                <th className="px-3 py-2 text-right">Longitude</th>
                <th className="px-3 py-2 text-right">Radius (m)</th>
                <th className="px-3 py-2 text-left">Fitur</th>
                <th className="px-3 py-2 text-right">Shift</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const busy = deleteMut.isPending && deleteMut.variables === r.id;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {r.latitude.toFixed(6)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {r.longitude.toFixed(6)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.radiusMeters}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.maxLeewayMeters > 0 ? (
                          <span
                            className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900"
                            title={`Server menerima clock-in dalam radius + min(akurasi, ${r.maxLeewayMeters}m). Set 0 untuk mode strict.`}
                          >
                            Leeway {r.maxLeewayMeters}m
                          </span>
                        ) : (
                          <span
                            className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium text-neutral-700"
                            title="Strict: titik harus persis di dalam radius (leeway 0)."
                          >
                            Strict
                          </span>
                        )}
                        {r.maxAccuracyMeters !== null ? (
                          <span
                            className="bg-info/10 text-info rounded px-1.5 py-0.5 text-[10px] font-medium"
                            title={`Menolak clock-in dengan accuracy > ${r.maxAccuracyMeters}m`}
                          >
                            Acc ≤ {r.maxAccuracyMeters}m
                          </span>
                        ) : null}
                        {r.allowedSsids.length > 0 ? (
                          <span
                            className="bg-success/10 text-success rounded px-1.5 py-0.5 text-[10px] font-medium"
                            title={r.allowedSsids.join(', ')}
                          >
                            Wi-Fi × {r.allowedSsids.length}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.shiftCount}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(r)}
                          className="rounded-md border px-2 py-1 text-xs"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy || r.shiftCount > 0}
                          title={r.shiftCount > 0 ? 'Masih dipakai oleh Shift' : undefined}
                          onClick={() => {
                            if (window.confirm(`Hapus geofence "${r.name}"?`)) {
                              deleteMut.mutate(r.id);
                            }
                          }}
                          className="border-destructive text-destructive rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                        >
                          {busy ? 'Menghapus...' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
