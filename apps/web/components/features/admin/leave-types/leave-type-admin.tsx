'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminLeaveType,
  CreateLeaveTypeInput,
  LeaveKind,
  UpdateLeaveTypeInput,
} from '@workpulse/shared-types';
import { useState } from 'react';

import { ApiError, leaveTypesAdminApi } from '@/lib/api-client';

import { LeaveTypeForm } from './leave-type-form';

const KIND_LABELS: Record<LeaveKind, string> = {
  ANNUAL: 'Cuti Tahunan',
  SICK: 'Sakit',
  PERSONAL: 'Pribadi',
  MATERNITY: 'Melahirkan',
  PATERNITY: 'Ayah',
  UNPAID: 'Tanpa Bayar',
  OTHER: 'Lainnya',
};

const ERROR_COPY: Record<string, string> = {
  LEAVE_TYPE_CODE_TAKEN: 'Kode tipe cuti sudah dipakai.',
  LEAVE_TYPE_HAS_OPEN_REQUESTS: 'Tidak bisa dihapus: masih ada permintaan cuti aktif / mendatang.',
  LEAVE_TYPE_NOT_FOUND: 'Tipe cuti tidak ditemukan.',
};

export function LeaveTypeAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminLeaveType | 'new' | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'leave-types'],
    queryFn: () => leaveTypesAdminApi.list(),
  });

  const createMut = useMutation({
    mutationFn: (v: CreateLeaveTypeInput) => leaveTypesAdminApi.create(v),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'leave-types'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: UpdateLeaveTypeInput }) =>
      leaveTypesAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'leave-types'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => leaveTypesAdminApi.remove(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'leave-types'] });
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
          <h2 className="text-lg font-semibold">Tipe Cuti</h2>
          <p className="text-muted-foreground text-xs">
            Menambah tipe baru akan otomatis mengalokasikan saldo untuk seluruh karyawan aktif tahun
            ini.
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
            {editing === 'new' ? 'Tambah Tipe Cuti' : `Edit: ${editing.name}`}
          </p>
          <LeaveTypeForm
            initial={editing === 'new' ? null : editing}
            submitting={createMut.isPending || updateMut.isPending}
            onSubmit={(values) => {
              if (editing === 'new') createMut.mutate(values);
              else {
                const { code: _code, ...rest } = values;
                void _code;
                updateMut.mutate({ id: editing.id, input: rest });
              }
            }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Belum ada tipe cuti. Tambahkan minimal <code className="font-mono">ANNUAL</code>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Kode</th>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-left">Kategori</th>
                <th className="px-3 py-2 text-right">Kuota</th>
                <th className="px-3 py-2 text-right">Carry-Over</th>
                <th className="px-3 py-2 text-center">Lampiran</th>
                <th className="px-3 py-2 text-right">Saldo Aktif</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const busy = deleteMut.isPending && deleteMut.variables === r.id;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
                    <td className="text-muted-foreground px-3 py-2 text-xs">
                      {KIND_LABELS[r.kind]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.defaultAnnualQuota}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.carryOverMax}</td>
                    <td className="px-3 py-2 text-center">
                      {r.requiresAttachment ? 'Wajib' : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.balanceCount}</td>
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
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Hapus tipe cuti "${r.name}"?`))
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
    </div>
  );
}
