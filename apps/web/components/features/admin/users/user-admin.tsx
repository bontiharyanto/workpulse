'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type {
  AdminUser,
  CreateUserInput,
  UpdateUserInput,
  UserRole,
} from '@workpulse/shared-types';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, departmentsAdminApi, usersAdminApi } from '@/lib/api-client';

import { CredentialReveal } from '../credential-reveal';

import { UserEditPanel } from './user-edit-panel';
import { UserForm } from './user-form';

const ROLE_LABELS: Record<UserRole, string> = {
  EMPLOYEE: 'Employee',
  SUPERVISOR: 'Supervisor',
  HR_MANAGER: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
};

const ERROR_COPY: Record<string, string> = {
  ROLE_ASSIGNMENT_FORBIDDEN: 'Anda tidak berhak menetapkan role tersebut.',
  CANNOT_MANAGE_HIGHER_ROLE: 'Anda tidak dapat mengubah user dengan role di atas Anda.',
  EMAIL_ALREADY_TAKEN: 'Email sudah terdaftar di company ini.',
  SELF_DEACTIVATE_FORBIDDEN: 'Anda tidak dapat menonaktifkan akun sendiri.',
  SELF_ROLE_CHANGE_FORBIDDEN: 'Anda tidak dapat mengubah role sendiri.',
  SELF_STATUS_CHANGE_FORBIDDEN: 'Anda tidak dapat mengubah status sendiri.',
  SUPERVISOR_CANNOT_BE_SELF: 'Atasan tidak boleh diri sendiri.',
  SUPERVISOR_MUST_HAVE_LEAD_ROLE: 'Atasan harus berupa Supervisor / HR / Admin.',
  SUPERVISOR_INVALID: 'Atasan tidak ditemukan di company ini.',
  DEPARTMENT_INVALID: 'Departemen tidak ditemukan.',
  USER_NOT_FOUND: 'User tidak ditemukan.',
  FORBIDDEN: 'Anda tidak memiliki akses.',
};

interface Reveal {
  email: string;
  temporaryPassword: string;
  title: string;
}

export function UserAdmin(): JSX.Element {
  const { user: actor } = useAuth();
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [mode, setMode] = useState<'idle' | 'create' | { edit: AdminUser }>('idle');
  const [filters, setFilters] = useState<{
    search: string;
    role: '' | UserRole;
    departmentId: string;
    includeInactive: boolean;
  }>({ search: '', role: '', departmentId: '', includeInactive: false });

  const departments = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => departmentsAdminApi.list(),
  });

  const users = useQuery({
    queryKey: ['admin', 'users', filters],
    queryFn: () =>
      usersAdminApi.list({
        search: filters.search || undefined,
        role: filters.role || undefined,
        departmentId: filters.departmentId || undefined,
        includeInactive: filters.includeInactive,
      }),
  });

  const potentialSupervisors = useMemo(
    () => (users.data ?? []).filter((u) => u.role !== 'EMPLOYEE' && !u.deactivatedAt),
    [users.data],
  );

  function mapError(err: unknown): void {
    if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) setErrorText(err.message);
  }

  const createMut = useMutation({
    mutationFn: (input: CreateUserInput) => usersAdminApi.create(input),
    onSuccess: (res) => {
      setErrorText(null);
      setMode('idle');
      setReveal({
        email: res.user.email,
        temporaryPassword: res.temporaryPassword,
        title: `Karyawan "${res.user.fullName}" berhasil dibuat`,
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: UpdateUserInput }) => usersAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setMode('idle');
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: mapError,
  });

  const resetMut = useMutation({
    mutationFn: (id: string) => usersAdminApi.resetPassword(id),
    onSuccess: (res) => {
      setErrorText(null);
      setReveal({
        email: res.user.email,
        temporaryPassword: res.temporaryPassword,
        title: `Password sementara untuk ${res.user.fullName}`,
      });
    },
    onError: mapError,
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => usersAdminApi.deactivate(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: mapError,
  });

  if (!actor) return <></>;

  const rows = users.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Karyawan</h2>
          <p className="text-muted-foreground text-xs">
            Kelola akun karyawan, atasan, dan role. Password sementara dibuat otomatis dan hanya
            ditampilkan sekali.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode('create');
            setErrorText(null);
          }}
          className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium"
        >
          + Tambah karyawan
        </button>
      </div>

      {reveal && (
        <CredentialReveal
          email={reveal.email}
          temporaryPassword={reveal.temporaryPassword}
          title={reveal.title}
          onDismiss={() => setReveal(null)}
        />
      )}

      {errorText && (
        <p
          role="alert"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorText}
        </p>
      )}

      <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-4">
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Cari nama / email..."
          className="border-input bg-background rounded-md border px-3 py-2 text-sm md:col-span-2"
        />
        <select
          value={filters.role}
          onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value as '' | UserRole }))}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Semua role</option>
          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select
          value={filters.departmentId}
          onChange={(e) => setFilters((f) => ({ ...f, departmentId: e.target.value }))}
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        >
          <option value="">Semua departemen</option>
          {(departments.data ?? []).map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="text-muted-foreground col-span-full flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={filters.includeInactive}
            onChange={(e) => setFilters((f) => ({ ...f, includeInactive: e.target.checked }))}
          />
          Tampilkan yang sudah dinonaktifkan
        </label>
      </div>

      {mode === 'create' && (
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Tambah Karyawan</p>
          <UserForm
            actorRole={actor.role}
            departments={departments.data ?? []}
            potentialSupervisors={potentialSupervisors}
            submitting={createMut.isPending}
            onSubmit={(v) => createMut.mutate(v)}
            onCancel={() => setMode('idle')}
          />
        </div>
      )}

      {typeof mode === 'object' && 'edit' in mode && (
        <div className="rounded-lg border p-4">
          <p className="mb-3 text-sm font-medium">Edit: {mode.edit.fullName}</p>
          <UserEditPanel
            actorId={actor.id}
            actorRole={actor.role}
            target={mode.edit}
            departments={departments.data ?? []}
            potentialSupervisors={potentialSupervisors}
            submitting={updateMut.isPending}
            onSubmit={(input) => updateMut.mutate({ id: mode.edit.id, input })}
            onCancel={() => setMode('idle')}
          />
        </div>
      )}

      {users.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          Tidak ada hasil.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Departemen</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => {
                const inactive = Boolean(u.deactivatedAt);
                const busyReset = resetMut.isPending && resetMut.variables === u.id;
                const busyDeact = deactivateMut.isPending && deactivateMut.variables === u.id;
                return (
                  <tr key={u.id} className={inactive ? 'opacity-60' : undefined}>
                    <td className="px-3 py-2 font-medium">{u.fullName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2">{ROLE_LABELS[u.role]}</td>
                    <td className="text-muted-foreground px-3 py-2">{u.departmentName ?? '—'}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          u.employmentStatus === 'ACTIVE'
                            ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300'
                            : 'bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs'
                        }
                      >
                        {u.employmentStatus}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={inactive}
                          onClick={() => setMode({ edit: u })}
                          className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={inactive || busyReset}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Reset password untuk ${u.fullName}? Semua sesi login akan dicabut.`,
                              )
                            ) {
                              resetMut.mutate(u.id);
                            }
                          }}
                          className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                        >
                          {busyReset ? 'Reset...' : 'Reset password'}
                        </button>
                        <button
                          type="button"
                          disabled={inactive || busyDeact || u.id === actor.id}
                          title={
                            u.id === actor.id ? 'Tidak dapat menonaktifkan diri sendiri' : undefined
                          }
                          onClick={() => {
                            if (
                              window.confirm(
                                `Nonaktifkan akun ${u.fullName}? Sesi login akan dicabut.`,
                              )
                            ) {
                              deactivateMut.mutate(u.id);
                            }
                          }}
                          className="border-destructive text-destructive rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                        >
                          {busyDeact ? 'Menonaktifkan...' : 'Nonaktifkan'}
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
