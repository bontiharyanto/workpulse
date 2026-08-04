'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateDepartmentInput, Department } from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, departmentsAdminApi } from '@/lib/api-client';

import { DepartmentForm } from './department-form';

const ERROR_COPY: Record<string, string> = {
  DEPARTMENT_NAME_TAKEN: 'Nama departemen sudah dipakai.',
  DEPARTMENT_HAS_ACTIVE_USERS: 'Tidak bisa dihapus: masih ada karyawan aktif.',
  DEPARTMENT_HAS_CHILDREN: 'Tidak bisa dihapus: masih ada sub-departemen.',
  DEPARTMENT_CYCLE_DETECTED: 'Parent akan membentuk siklus.',
  DEPARTMENT_PARENT_INVALID: 'Parent tidak ditemukan di company ini.',
  DEPARTMENT_PARENT_CANNOT_BE_SELF: 'Departemen tidak bisa menjadi parent dirinya sendiri.',
  FORBIDDEN: 'Anda tidak memiliki akses.',
};

export function DepartmentAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState<Department | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => departmentsAdminApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (v: CreateDepartmentInput) => departmentsAdminApi.create(v),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'departments'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: CreateDepartmentInput }) =>
      departmentsAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'departments'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => departmentsAdminApi.remove(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'departments'] });
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
          <h2 className="text-lg font-semibold">Departemen</h2>
          <p className="text-muted-foreground text-xs">
            Struktur organisasi. Departemen tidak bisa dihapus jika masih memiliki karyawan aktif.
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
            {editing === 'new' ? 'Tambah Departemen' : `Edit: ${editing.name}`}
          </p>
          <DepartmentForm
            parents={rows}
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
          Belum ada departemen.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-left">Parent</th>
                <th className="px-3 py-2 text-right">Karyawan</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const busy = deleteMut.isPending && deleteMut.variables === r.id;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="text-muted-foreground px-3 py-2">{r.parentName ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.userCount}</td>
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
                          disabled={busy || r.userCount > 0}
                          title={r.userCount > 0 ? 'Pindahkan karyawan terlebih dahulu' : undefined}
                          onClick={() => {
                            if (window.confirm(`Hapus departemen "${r.name}"?`)) {
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
