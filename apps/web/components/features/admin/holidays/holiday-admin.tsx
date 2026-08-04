'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  BulkImportHolidaysResponse,
  CreateHolidayInput,
  Holiday,
  UpdateHolidayInput,
} from '@workpulse/shared-types';

import { ApiError, holidaysAdminApi } from '@/lib/api-client';

import { HolidayBulkImport } from './holiday-bulk-import';
import { HolidayForm } from './holiday-form';

const ERROR_COPY: Record<string, string> = {
  HOLIDAY_DATE_TAKEN: 'Tanggal ini sudah terdaftar sebagai hari libur.',
  HOLIDAY_NOT_FOUND: 'Hari libur tidak ditemukan.',
};

const currentYear = new Date().getUTCFullYear();

function formatDateID(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function HolidayAdmin(): JSX.Element {
  const qc = useQueryClient();
  const [year, setYear] = useState<number>(currentYear);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [editing, setEditing] = useState<Holiday | 'new' | null>(null);
  const [bulkMode, setBulkMode] = useState<boolean>(false);
  const [bulkResult, setBulkResult] = useState<BulkImportHolidaysResponse | null>(null);

  const list = useQuery({
    queryKey: ['admin', 'holidays', year],
    queryFn: () => holidaysAdminApi.list(year),
  });

  const createMut = useMutation({
    mutationFn: (v: CreateHolidayInput) => holidaysAdminApi.create(v),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'holidays'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: UpdateHolidayInput }) =>
      holidaysAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'holidays'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => holidaysAdminApi.remove(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'holidays'] });
    },
    onError: mapError,
  });

  const bulkMut = useMutation({
    mutationFn: (items: CreateHolidayInput[]) => holidaysAdminApi.bulk({ items }),
    onSuccess: (res) => {
      setErrorText(null);
      setBulkResult(res);
      void qc.invalidateQueries({ queryKey: ['admin', 'holidays'] });
    },
    onError: mapError,
  });

  function mapError(err: unknown): void {
    if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) setErrorText(err.message);
  }

  const rows = list.data ?? [];
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Hari Libur</h2>
          <p className="text-muted-foreground text-xs">
            Dipakai oleh mesin kalkulasi cuti untuk mengecualikan hari libur nasional dari
            perhitungan hari kerja.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wider">Tahun</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="border-input bg-background rounded-md border px-2 py-1 text-sm tabular-nums"
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setBulkMode(true);
              setBulkResult(null);
            }}
            className="rounded-md border px-3 py-1 text-xs"
          >
            Bulk Import
          </button>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium"
          >
            + Tambah
          </button>
        </div>
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
            {editing === 'new' ? 'Tambah Hari Libur' : `Edit: ${editing.name}`}
          </p>
          <HolidayForm
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

      {bulkMode && (
        <HolidayBulkImport
          submitting={bulkMut.isPending}
          result={bulkResult}
          onSubmit={(items) => bulkMut.mutate(items)}
          onCancel={() => {
            setBulkMode(false);
            setBulkResult(null);
          }}
        />
      )}

      {list.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Belum ada hari libur untuk tahun {year}. Gunakan Bulk Import untuk mempercepat.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Tanggal</th>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => {
                const busy = deleteMut.isPending && deleteMut.variables === r.id;
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2 tabular-nums">
                      <span className="text-muted-foreground font-mono text-xs">{r.date}</span>
                      <span className="ml-2 text-xs">· {formatDateID(r.date)}</span>
                    </td>
                    <td className="px-3 py-2 font-medium">{r.name}</td>
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
                            if (window.confirm(`Hapus hari libur "${r.name}" (${r.date})?`)) {
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

      <p className="text-muted-foreground text-xs">
        <strong>Catatan:</strong> Menghapus atau mengubah tanggal hari libur tidak mengubah
        permohonan cuti yang sudah tersimpan — kolom <code className="font-mono">days</code>{' '}
        dihitung dan disimpan saat pengajuan (snapshot).
      </p>
    </div>
  );
}
