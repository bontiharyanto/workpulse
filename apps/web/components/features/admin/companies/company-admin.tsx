'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { CompanyAdmin, CreateCompanyInput, UpdateCompanyInput } from '@workpulse/shared-types';

import { useAuth } from '@/components/providers/auth-provider';
import { ApiError, companiesAdminApi } from '@/lib/api-client';

import { CredentialReveal } from '../credential-reveal';

import { CompanyEditPanel } from './company-edit-panel';
import { CompanyForm } from './company-form';

/**
 * Mapping API error codes → operator-friendly Indonesian copy. Keep this
 * exhaustive against `apps/api/src/company-admin/company-admin.service.ts`
 * — silent fallbacks hide guardrail violations from SUPER_ADMINs.
 */
const ERROR_COPY: Record<string, string> = {
  COMPANY_NOT_FOUND: 'Tenant tidak ditemukan.',
  SLUG_ALREADY_TAKEN: 'Slug tersebut sudah digunakan tenant lain.',
  INVALID_SLUG: 'Format slug tidak valid.',
  EMAIL_ALREADY_TAKEN: 'Email HR sudah terpakai di tenant ini.',
  INVALID_TIMEZONE: 'Timezone tidak dikenali oleh sistem.',
  EMPTY_UPDATE: 'Setidaknya satu field harus diubah.',
  COMPANY_ALREADY_DELETED: 'Tenant sudah dinonaktifkan.',
  COMPANY_NOT_DELETED: 'Tenant tidak dalam status dinonaktifkan.',
  COMPANY_HAS_ACTIVE_USERS:
    'Masih ada karyawan aktif. Nonaktifkan seluruh karyawan lebih dulu di menu Karyawan.',
  CANNOT_DELETE_OWN_TENANT: 'Anda tidak dapat menonaktifkan tenant sendiri.',
  SUPER_ADMIN_REQUIRED: 'Hanya SUPER_ADMIN yang berwenang.',
  FORBIDDEN: 'Anda tidak memiliki akses.',
};

interface Reveal {
  email: string;
  temporaryPassword: string;
  title: string;
}

const PAGE_SIZE = 20;

export function CompanyAdmin(): JSX.Element {
  const { user: actor } = useAuth();
  const qc = useQueryClient();
  const [errorText, setErrorText] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [mode, setMode] = useState<'idle' | 'create' | { edit: CompanyAdmin }>('idle');
  const [filters, setFilters] = useState<{
    search: string;
    includeDeleted: boolean;
    page: number;
  }>({ search: '', includeDeleted: false, page: 1 });

  const query = useQuery({
    queryKey: ['admin', 'companies', filters],
    queryFn: () =>
      companiesAdminApi.list({
        search: filters.search || undefined,
        includeDeleted: filters.includeDeleted || undefined,
        page: filters.page,
        pageSize: PAGE_SIZE,
      }),
  });

  function mapError(err: unknown): void {
    if (err instanceof ApiError) setErrorText(ERROR_COPY[err.code] ?? err.message);
    else if (err instanceof Error) setErrorText(err.message);
  }

  const createMut = useMutation({
    mutationFn: (input: CreateCompanyInput) => companiesAdminApi.create(input),
    onSuccess: (res) => {
      setErrorText(null);
      setMode('idle');
      setReveal({
        email: res.hrEmail,
        temporaryPassword: res.temporaryPassword,
        title: `Tenant "${res.company.name}" dan HR awal berhasil dibuat`,
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
    },
    onError: mapError,
  });

  const updateMut = useMutation({
    mutationFn: (v: { id: string; input: UpdateCompanyInput }) =>
      companiesAdminApi.update(v.id, v.input),
    onSuccess: () => {
      setErrorText(null);
      setMode('idle');
      void qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
    },
    onError: mapError,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => companiesAdminApi.softDelete(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
    },
    onError: mapError,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => companiesAdminApi.restore(id),
    onSuccess: () => {
      setErrorText(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'companies'] });
    },
    onError: mapError,
  });

  if (!actor) return <></>;

  const rows = query.data?.items ?? [];
  const totalCount = query.data?.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-4" data-testid="company-admin-root">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Tenant</h2>
          <p className="text-muted-foreground text-xs">
            Kelola perusahaan (multi-tenant) beserta akun HR awal. Membuat tenant baru akan menyeed
            tipe cuti default dan menghasilkan password sementara sekali pakai untuk HR.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode('create');
            setErrorText(null);
          }}
          data-testid="add-company-btn"
          className="bg-foreground text-background rounded-md px-3 py-1 text-xs font-medium"
        >
          + Tambah tenant
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
          data-testid="company-error"
          className="border-destructive/40 bg-destructive/5 text-destructive rounded-md border px-3 py-2 text-sm"
        >
          {errorText}
        </p>
      )}

      <div className="grid gap-2 rounded-md border p-3 text-sm md:grid-cols-4">
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
          placeholder="Cari nama / slug..."
          data-testid="company-search-input"
          className="border-input bg-background rounded-md border px-3 py-2 text-sm md:col-span-3"
        />
        <label className="text-muted-foreground flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={filters.includeDeleted}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                includeDeleted: e.target.checked,
                page: 1,
              }))
            }
            data-testid="company-include-deleted-checkbox"
          />
          Tampilkan yang dinonaktifkan
        </label>
      </div>

      {mode === 'create' && (
        <div className="rounded-lg border p-4" data-testid="company-create-panel">
          <p className="mb-3 text-sm font-medium">Tambah Tenant</p>
          <CompanyForm
            submitting={createMut.isPending}
            onSubmit={(v) => createMut.mutate(v)}
            onCancel={() => setMode('idle')}
          />
        </div>
      )}

      {typeof mode === 'object' && 'edit' in mode && (
        <div className="rounded-lg border p-4" data-testid="company-edit-panel">
          <p className="mb-3 text-sm font-medium">Edit: {mode.edit.name}</p>
          <CompanyEditPanel
            target={mode.edit}
            submitting={updateMut.isPending}
            onSubmit={(input) => updateMut.mutate({ id: mode.edit.id, input })}
            onCancel={() => setMode('idle')}
          />
        </div>
      )}

      {query.isLoading ? (
        <p className="text-muted-foreground text-sm">Memuat...</p>
      ) : rows.length === 0 ? (
        <p
          data-testid="company-empty-state"
          className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm"
        >
          Tidak ada tenant yang cocok.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" data-testid="company-table">
              <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-3 py-2 text-left">Nama</th>
                  <th className="px-3 py-2 text-left">Slug</th>
                  <th className="px-3 py-2 text-left">Timezone</th>
                  <th className="px-3 py-2 text-right">User</th>
                  <th className="px-3 py-2 text-right">Departemen</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((c) => {
                  const isDeleted = Boolean(c.deletedAt);
                  const isSelf = c.id === actor.companyId;
                  const busyDelete = deleteMut.isPending && deleteMut.variables === c.id;
                  const busyRestore = restoreMut.isPending && restoreMut.variables === c.id;
                  return (
                    <tr
                      key={c.id}
                      data-testid={`company-row-${c.slug}`}
                      className={isDeleted ? 'opacity-60' : undefined}
                    >
                      <td className="px-3 py-2 font-medium">
                        {c.name}
                        {isSelf && (
                          <span className="ml-2 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300">
                            Sendiri
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{c.slug}</td>
                      <td className="text-muted-foreground px-3 py-2">{c.timezone}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.userCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{c.departmentCount}</td>
                      <td className="px-3 py-2">
                        {isDeleted ? (
                          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                            Dinonaktifkan
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                            Aktif
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={isDeleted}
                            onClick={() => setMode({ edit: c })}
                            data-testid={`company-edit-${c.slug}`}
                            className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                          >
                            Edit
                          </button>
                          {isDeleted ? (
                            <button
                              type="button"
                              disabled={busyRestore}
                              onClick={() => {
                                if (
                                  window.confirm(`Aktifkan kembali tenant ${c.name} (${c.slug})?`)
                                ) {
                                  restoreMut.mutate(c.id);
                                }
                              }}
                              data-testid={`company-restore-${c.slug}`}
                              className="rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                            >
                              {busyRestore ? 'Memulihkan...' : 'Aktifkan kembali'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busyDelete || isSelf}
                              title={
                                isSelf ? 'Tidak dapat menonaktifkan tenant sendiri' : undefined
                              }
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `Nonaktifkan tenant ${c.name}? Data tetap tersimpan dan dapat diaktifkan kembali. Pastikan semua karyawan sudah dinonaktifkan.`,
                                  )
                                ) {
                                  deleteMut.mutate(c.id);
                                }
                              }}
                              data-testid={`company-delete-${c.slug}`}
                              className="border-destructive text-destructive rounded-md border px-2 py-1 text-xs disabled:opacity-40"
                            >
                              {busyDelete ? 'Menonaktifkan...' : 'Nonaktifkan'}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <p>
              Menampilkan {(filters.page - 1) * PAGE_SIZE + 1}–
              {Math.min(filters.page * PAGE_SIZE, totalCount)} dari {totalCount}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={filters.page <= 1}
                onClick={() => setFilters((f) => ({ ...f, page: Math.max(1, f.page - 1) }))}
                className="rounded-md border px-2 py-1 disabled:opacity-40"
              >
                ← Sebelumnya
              </button>
              <span className="tabular-nums">
                {filters.page} / {totalPages}
              </span>
              <button
                type="button"
                disabled={filters.page >= totalPages}
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    page: Math.min(totalPages, f.page + 1),
                  }))
                }
                className="rounded-md border px-2 py-1 disabled:opacity-40"
              >
                Berikutnya →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
