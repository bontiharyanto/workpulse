'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, CreateShiftAssignmentInput, Shift } from '@workpulse/shared-types';
import { useEffect, useState } from 'react';

import { ApiError, shiftAssignmentsAdminApi, usersAdminApi } from '@/lib/api-client';

interface Props {
  shifts: Shift[];
  onError: (message: string) => void;
  onClearError: () => void;
  /**
   * Optional userId to pre-select the assignment target. When it changes the
   * panel switches focus to that user; typical trigger is the
   * "Assign now" button on the "users without active shift" card, or an
   * external deep link like `/admin/shifts?userId=<id>`.
   */
  initialUserId?: string;
}

/**
 * Anchor id used by the "users without active shift" card to scroll the
 * page down after preselecting a user. Kept as a stable constant so
 * external links (e.g. notifications) can also target the same anchor.
 */
export const SHIFT_ASSIGNMENT_PANEL_ANCHOR = 'shift-assignment-panel';

const ERROR_COPY: Record<string, string> = {
  ASSIGNMENT_OVERLAP: 'Karyawan sudah memiliki shift yang tumpang tindih di periode ini.',
  ASSIGNMENT_INVALID_RANGE: 'Rentang tanggal tidak valid.',
  ASSIGNMENT_ALREADY_STARTED_USE_END:
    'Assignment sudah berjalan; gunakan tombol "Akhiri" untuk menutupnya.',
  ASSIGNMENT_NOT_FOUND: 'Assignment tidak ditemukan.',
  USER_INVALID: 'Karyawan tidak valid.',
};

export function ShiftAssignmentPanel({
  shifts,
  onError,
  onClearError,
  initialUserId,
}: Props): JSX.Element {
  const qc = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string>(initialUserId ?? '');

  // Keep the local selection in sync with the external deep-link (URL search
  // param). Doing it in an effect (rather than a controlled prop) preserves
  // the panel's ability to be driven from an internal <select> too.
  useEffect(() => {
    if (initialUserId && initialUserId !== selectedUserId) {
      setSelectedUserId(initialUserId);
    }
  }, [initialUserId, selectedUserId]);
  const [form, setForm] = useState<{
    shiftId: string;
    effectiveFrom: string;
    effectiveTo: string;
  }>({
    shiftId: shifts[0]?.id ?? '',
    effectiveFrom: new Date().toISOString().slice(0, 10),
    effectiveTo: '',
  });

  const users = useQuery({
    queryKey: ['admin', 'users', 'active'],
    queryFn: () => usersAdminApi.list({ includeInactive: false }) as Promise<AdminUser[]>,
  });

  const assignments = useQuery({
    queryKey: ['admin', 'shift-assignments', selectedUserId],
    queryFn: () => shiftAssignmentsAdminApi.listForUser(selectedUserId),
    enabled: Boolean(selectedUserId),
  });

  // Assignment mutations invalidate three query keys so every surface
  // that depends on "who has an in-force shift" refreshes together:
  //   1. `shift-assignments/<userId>`  — the timeline table below.
  //   2. `admin/shifts`                 — the shift list (`activeAssignments` counter).
  //   3. `users-without-active-shift`   — the warning card at the top.
  function invalidateAll(): void {
    void qc.invalidateQueries({ queryKey: ['admin', 'shift-assignments', selectedUserId] });
    void qc.invalidateQueries({ queryKey: ['admin', 'shifts'] });
    void qc.invalidateQueries({
      queryKey: ['admin', 'shifts', 'users-without-active-shift'],
    });
  }

  const createMut = useMutation({
    mutationFn: (v: { shiftId: string; input: CreateShiftAssignmentInput }) =>
      shiftAssignmentsAdminApi.create(v.shiftId, v.input),
    onSuccess: () => {
      onClearError();
      invalidateAll();
    },
    onError: handleErr,
  });

  const endMut = useMutation({
    mutationFn: (v: { id: string; effectiveTo: string }) =>
      shiftAssignmentsAdminApi.end(v.id, { effectiveTo: v.effectiveTo }),
    onSuccess: () => {
      onClearError();
      invalidateAll();
    },
    onError: handleErr,
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => shiftAssignmentsAdminApi.remove(id),
    onSuccess: () => {
      onClearError();
      invalidateAll();
    },
    onError: handleErr,
  });

  function handleErr(err: unknown): void {
    if (err instanceof ApiError) onError(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) onError(err.message);
  }

  const activeUsers = users.data ?? [];
  const rows = assignments.data ?? [];

  return (
    <div
      id={SHIFT_ASSIGNMENT_PANEL_ANCHOR}
      className="space-y-3 rounded-lg border p-4 scroll-mt-4"
    >
      <div>
        <h3 className="text-sm font-semibold">Assignment Shift → Karyawan</h3>
        <p className="text-muted-foreground text-xs">
          Pilih karyawan untuk melihat riwayat &amp; menambah shift baru.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="text-xs font-medium uppercase tracking-wider">Karyawan</label>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="border-input bg-background mt-1 w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="">— Pilih karyawan —</option>
            {activeUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} — {u.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      {selectedUserId && (
        <>
          <div className="grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wider">Shift</label>
              <select
                value={form.shiftId}
                onChange={(e) => setForm({ ...form, shiftId: e.target.value })}
                className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm"
              >
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.startTime}–{s.endTime}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider">Berlaku Dari</label>
              <input
                type="date"
                value={form.effectiveFrom}
                onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })}
                className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wider">
                Berlaku Sampai (opsional)
              </label>
              <input
                type="date"
                value={form.effectiveTo}
                onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })}
                className="border-input bg-background mt-1 w-full rounded-md border px-2 py-1 text-sm tabular-nums"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={!form.shiftId || !form.effectiveFrom || createMut.isPending}
                onClick={() => {
                  createMut.mutate({
                    shiftId: form.shiftId,
                    input: {
                      userId: selectedUserId,
                      effectiveFrom: form.effectiveFrom,
                      effectiveTo: form.effectiveTo || null,
                    },
                  });
                }}
                className="bg-foreground text-background w-full rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50"
              >
                + Assign
              </button>
            </div>
          </div>

          {assignments.isLoading ? (
            <p className="text-muted-foreground text-xs">Memuat riwayat...</p>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-xs">
              Belum ada assignment untuk karyawan ini.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-muted-foreground text-[10px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-1.5 text-left">Shift</th>
                    <th className="px-2 py-1.5 text-left">Berlaku Dari</th>
                    <th className="px-2 py-1.5 text-left">Berlaku Sampai</th>
                    <th className="px-2 py-1.5 text-left">Status</th>
                    <th className="px-2 py-1.5 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((a) => {
                    const busyEnd = endMut.isPending && endMut.variables?.id === a.id;
                    const busyDel = removeMut.isPending && removeMut.variables === a.id;
                    return (
                      <tr key={a.id}>
                        <td className="px-2 py-1.5 font-medium">{a.shiftName}</td>
                        <td className="px-2 py-1.5 tabular-nums">{a.effectiveFrom}</td>
                        <td className="px-2 py-1.5 tabular-nums">{a.effectiveTo ?? '—'}</td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              a.active
                                ? 'inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700'
                                : 'bg-muted text-muted-foreground inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium'
                            }
                          >
                            {a.active ? 'Aktif' : 'Selesai'}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <div className="flex justify-end gap-2">
                            {a.active && (
                              <button
                                type="button"
                                disabled={busyEnd}
                                onClick={() => {
                                  const to = window.prompt(
                                    'Akhiri assignment pada tanggal (YYYY-MM-DD):',
                                    new Date().toISOString().slice(0, 10),
                                  );
                                  if (to) endMut.mutate({ id: a.id, effectiveTo: to });
                                }}
                                className="rounded-md border px-2 py-0.5 text-[10px]"
                              >
                                {busyEnd ? 'Menutup...' : 'Akhiri'}
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={busyDel}
                              title="Hanya bisa dihapus jika belum mulai berlaku"
                              onClick={() => {
                                if (window.confirm('Hapus assignment ini?')) removeMut.mutate(a.id);
                              }}
                              className="border-destructive text-destructive rounded-md border px-2 py-0.5 text-[10px] disabled:opacity-40"
                            >
                              {busyDel ? '...' : 'Hapus'}
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
        </>
      )}
    </div>
  );
}
