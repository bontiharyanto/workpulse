'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateShiftInput, Shift, UpdateShiftInput } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, geofencesAdminApi, shiftsAdminApi } from '@/lib/api-client';

import { ShiftAssignmentPanel } from './shift-assignment-panel';
import { ShiftForm } from './shift-form';

const ERROR_COPY: Record<string, string> = {
  SHIFT_NAME_TAKEN: 'Nama shift sudah dipakai.',
  SHIFT_TIMES_INVALID: 'Jam mulai dan selesai tidak boleh sama.',
  SHIFT_HAS_ACTIVE_ASSIGNMENTS: 'Tidak bisa dihapus: masih ada assignment aktif.',
  SHIFT_NOT_FOUND: 'Shift tidak ditemukan.',
  GEOFENCE_INVALID: 'Geofence yang dipilih tidak valid.',
};

export function ShiftAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState<Shift | 'new' | null>(null);

  const shifts = useQuery({
    queryKey: ['admin', 'shifts'],
    queryFn: () => shiftsAdminApi.list(),
  });

  const geofences = useQuery({
    queryKey: ['admin', 'geofences'],
    queryFn: () => geofencesAdminApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (v: CreateShiftInput) => shiftsAdminApi.create(v),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'shifts'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: UpdateShiftInput }) =>
      shiftsAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'shifts'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => shiftsAdminApi.remove(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'shifts'] });
    },
    onError: mapError,
  });

  function mapError(err: unknown): void {
    if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) setErrorText(err.message);
  }

  const rows = shifts.data ?? [];
  const gfs = geofences.data ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Shift</h2>
            <p className="text-muted-foreground text-xs">
              Template jam kerja. Assignment per-karyawan diatur di panel bawah.
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
              {editing === 'new' ? 'Tambah Shift' : `Edit: ${editing.name}`}
            </p>
            <ShiftForm
              initial={editing === 'new' ? null : editing}
              geofences={gfs}
              submitting={createMut.isPending || updateMut.isPending}
              onSubmit={(values) => {
                if (editing === 'new') createMut.mutate(values);
                else updateMut.mutate({ id: editing.id, input: values });
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}

        {shifts.isLoading ? (
          <p className="text-muted-foreground text-sm">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
            Belum ada shift. Tambahkan minimal satu shift default.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Nama</th>
                  <th className="px-3 py-2 text-left">Tipe</th>
                  <th className="px-3 py-2 text-left">Jam</th>
                  <th className="px-3 py-2 text-right">Grace</th>
                  <th className="px-3 py-2 text-left">Geofence</th>
                  <th className="px-3 py-2 text-right">Assignment Aktif</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const busy = deleteMut.isPending && deleteMut.variables === r.id;
                  const disabledDel = r.activeAssignments > 0;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="text-muted-foreground px-3 py-2 text-xs">{r.type}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.startTime} – {r.endTime}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.graceMinutes}m</td>
                      <td className="px-3 py-2 text-xs">
                        {r.geofenceName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.activeAssignments}</td>
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
                            disabled={busy || disabledDel}
                            title={disabledDel ? 'Masih ada assignment aktif' : undefined}
                            onClick={() => {
                              if (window.confirm(`Hapus shift "${r.name}"?`))
                                deleteMut.mutate(r.id);
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
      </section>

      <ShiftAssignmentPanel
        shifts={rows}
        onError={(m) => setErrorText(m)}
        onClearError={() => setErrorText(null)}
      />
    </div>
  );
}
