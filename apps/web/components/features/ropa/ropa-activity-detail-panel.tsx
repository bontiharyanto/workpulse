'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ropaLegalBasisSchema,
  updateRopaVersionInputSchema,
  type RopaVersionResponse,
  type UpdateRopaVersionInput,
} from '@workpulse/shared-types';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ApiError, ropaAdminApi } from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  ROPA_NOT_EDITABLE: 'Versi ini tidak berstatus DRAFT — tidak bisa di-edit.',
  ROPA_ILLEGAL_TRANSITION: 'Transisi status tidak valid untuk versi ini.',
  ROPA_OPEN_VERSION_EXISTS:
    'Sudah ada versi DRAFT/REVIEW yang belum ditutup. Selesaikan dulu.',
  THROTTLED: 'Terlalu banyak percobaan. Coba lagi sebentar.',
};

const STATUS_BADGE: Record<
  'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED',
  { label: string; className: string }
> = {
  DRAFT: {
    label: 'Draft',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100',
  },
  REVIEW: {
    label: 'Review',
    className: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100',
  },
  PUBLISHED: {
    label: 'Published',
    className:
      'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  },
  ARCHIVED: {
    label: 'Archived',
    className: 'bg-muted text-muted-foreground',
  },
};

const LEGAL_LABEL: Record<
  ReturnType<typeof ropaLegalBasisSchema.parse>,
  string
> = {
  CONTRACT: 'Pelaksanaan kontrak',
  CONSENT: 'Persetujuan',
  LEGAL_OBLIGATION: 'Kewajiban hukum',
  LEGITIMATE_INTEREST: 'Kepentingan sah',
  VITAL_INTEREST: 'Kepentingan vital',
  PUBLIC_TASK: 'Tugas publik',
};

function toDefaults(v: RopaVersionResponse): UpdateRopaVersionInput {
  return {
    name: v.name,
    purpose: v.purpose,
    legalBasis: v.legalBasis,
    legalBasisDetail: v.legalBasisDetail ?? null,
    dataCategories: v.dataCategories,
    subjectCategories: v.subjectCategories,
    recipients: v.recipients,
    retentionPeriod: v.retentionPeriod,
    crossBorderTransfer: v.crossBorderTransfer,
    crossBorderDetail: v.crossBorderDetail ?? null,
    securityMeasures: v.securityMeasures,
    notes: v.notes ?? null,
  };
}

export function RopaActivityDetailPanel({
  activityId,
}: {
  activityId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['ropa-activity', activityId],
    queryFn: () => ropaAdminApi.detail(activityId),
    staleTime: 10_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ['ropa-activity', activityId] });

  const submitReview = useMutation({
    mutationFn: (v: RopaVersionResponse) =>
      ropaAdminApi.submitReview(activityId, v.id),
    onSuccess: () => invalidate(),
  });
  const returnToDraft = useMutation({
    mutationFn: (v: RopaVersionResponse) =>
      ropaAdminApi.returnToDraft(activityId, v.id),
    onSuccess: () => invalidate(),
  });
  const publish = useMutation({
    mutationFn: (v: RopaVersionResponse) =>
      ropaAdminApi.publish(activityId, v.id),
    onSuccess: () => invalidate(),
  });
  const newVersion = useMutation({
    mutationFn: () => ropaAdminApi.newVersion(activityId),
    onSuccess: () => invalidate(),
  });

  const activeError = [submitReview, returnToDraft, publish, newVersion]
    .map((m) => m.error)
    .find((e): e is Error => Boolean(e));
  const activeErrorMessage = activeError
    ? activeError instanceof ApiError
      ? (ERROR_COPY[activeError.code] ?? activeError.message)
      : 'Terjadi kesalahan.'
    : null;

  if (detail.isLoading) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground"
      >
        Memuat detail…
      </div>
    );
  }

  if (!detail.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Aktivitas tidak ditemukan atau bukan milik tenant Anda.
        </p>
        <Link
          href={'/admin/ropa' as Route}
          className="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-muted"
        >
          ← Kembali ke daftar
        </Link>
      </div>
    );
  }

  const versions = detail.data.versions;
  const current =
    versions.find((v) => v.status === 'PUBLISHED') ??
    versions.find((v) => v.status === 'REVIEW') ??
    versions.find((v) => v.status === 'DRAFT') ??
    versions[0];
  const canOpenNew = !versions.some(
    (v) => v.status === 'DRAFT' || v.status === 'REVIEW',
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <Link
            href={'/admin/ropa' as Route}
            className="text-xs text-muted-foreground hover:underline"
          >
            ← Semua aktivitas
          </Link>
          <h2 className="text-xl font-semibold">{current?.name ?? detail.data.slug}</h2>
          <p className="text-xs text-muted-foreground">
            slug: {detail.data.slug} · {versions.length} versi
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!canOpenNew || newVersion.isPending}
            onClick={() => newVersion.mutate()}
            className="inline-flex items-center rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            {newVersion.isPending ? 'Membuat…' : 'Buka versi baru (DRAFT)'}
          </button>
        </div>
      </div>

      {activeErrorMessage && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {activeErrorMessage}
        </div>
      )}

      <ul className="space-y-3">
        {versions.map((v) => {
          const badge = STATUS_BADGE[v.status];
          return (
            <li
              key={v.id}
              className="rounded-lg border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium">
                    v{v.version}
                    <span
                      className={`ml-2 rounded px-2 py-0.5 text-xs ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Landasan: {LEGAL_LABEL[v.legalBasis] ?? v.legalBasis}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {v.status === 'DRAFT' && (
                    <button
                      type="button"
                      disabled={submitReview.isPending}
                      onClick={() => submitReview.mutate(v)}
                      className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      Submit ke review
                    </button>
                  )}
                  {v.status === 'REVIEW' && (
                    <>
                      <button
                        type="button"
                        disabled={returnToDraft.isPending}
                        onClick={() => returnToDraft.mutate(v)}
                        className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                      >
                        Kembalikan ke draft
                      </button>
                      <button
                        type="button"
                        disabled={publish.isPending}
                        onClick={() => publish.mutate(v)}
                        className="inline-flex items-center rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Publish
                      </button>
                    </>
                  )}
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  Lihat detail Art. 30 / Pasal 31
                </summary>
                <VersionDetail v={v} activityId={activityId} onUpdated={invalidate} />
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Read-only detail block plus, for DRAFT versions, an inline "Edit" form
 * so DPO can iterate quickly without a modal. Non-DRAFT versions render
 * everything as plain text (frozen record).
 */
function VersionDetail({
  v,
  activityId,
  onUpdated,
}: {
  v: RopaVersionResponse;
  activityId: string;
  onUpdated: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const form = useForm<UpdateRopaVersionInput>({
    resolver: zodResolver(updateRopaVersionInputSchema),
    defaultValues: toDefaults(v),
  });
  useEffect(() => {
    form.reset(toDefaults(v));
  }, [v, form]);

  const patch = useMutation({
    mutationFn: (input: UpdateRopaVersionInput) =>
      ropaAdminApi.patchVersion(activityId, v.id, input),
    onSuccess: () => {
      setEditing(false);
      onUpdated();
    },
  });

  const inlineError = patch.error
    ? patch.error instanceof ApiError
      ? (ERROR_COPY[patch.error.code] ?? patch.error.message)
      : 'Gagal menyimpan perubahan.'
    : null;

  if (!editing) {
    return (
      <div className="mt-3 space-y-2 text-sm">
        <Field label="Tujuan">{v.purpose}</Field>
        <Field label="Landasan hukum">
          {LEGAL_LABEL[v.legalBasis] ?? v.legalBasis}
          {v.legalBasisDetail ? ` — ${v.legalBasisDetail}` : ''}
        </Field>
        <Field label="Kategori data">
          {v.dataCategories.length > 0 ? v.dataCategories.join(', ') : '—'}
        </Field>
        <Field label="Kategori subjek data">
          {v.subjectCategories.length > 0
            ? v.subjectCategories.join(', ')
            : '—'}
        </Field>
        <Field label="Penerima data">
          {v.recipients.length > 0 ? v.recipients.join(', ') : '—'}
        </Field>
        <Field label="Periode retensi">{v.retentionPeriod}</Field>
        <Field label="Transfer lintas batas">
          {v.crossBorderTransfer
            ? `Ya${v.crossBorderDetail ? ` — ${v.crossBorderDetail}` : ''}`
            : 'Tidak'}
        </Field>
        <Field label="Langkah pengamanan">{v.securityMeasures}</Field>
        {v.notes && <Field label="Catatan">{v.notes}</Field>}
        {v.status === 'DRAFT' && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="mt-2 inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Edit draft
          </button>
        )}
      </div>
    );
  }

  const onSubmit = form.handleSubmit((values) => {
    patch.mutate(values);
  });

  return (
    <form onSubmit={onSubmit} className="mt-3 space-y-3 text-sm">
      <Input label="Nama aktivitas" name="name" form={form} />
      <TextArea label="Tujuan" name="purpose" form={form} rows={3} />
      <TextArea label="Landasan hukum (detail)" name="legalBasisDetail" form={form} rows={2} />
      <Input
        label="Kategori data (pisahkan dengan koma)"
        name="dataCategories"
        form={form}
        transformIn={(v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))}
        transformOut={(s) =>
          s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        }
      />
      <Input
        label="Kategori subjek data (pisahkan dengan koma)"
        name="subjectCategories"
        form={form}
        transformIn={(v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))}
        transformOut={(s) =>
          s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        }
      />
      <Input
        label="Penerima data (pisahkan dengan koma)"
        name="recipients"
        form={form}
        transformIn={(v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))}
        transformOut={(s) =>
          s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        }
      />
      <Input label="Periode retensi" name="retentionPeriod" form={form} />
      <label className="flex items-center gap-2">
        <input type="checkbox" {...form.register('crossBorderTransfer')} />
        <span>Ada transfer data lintas batas</span>
      </label>
      <TextArea
        label="Detail transfer lintas batas (opsional)"
        name="crossBorderDetail"
        form={form}
        rows={2}
      />
      <TextArea label="Langkah pengamanan" name="securityMeasures" form={form} rows={3} />
      <TextArea label="Catatan (opsional)" name="notes" form={form} rows={2} />

      {inlineError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/50 bg-destructive/5 p-2 text-xs text-destructive"
        >
          {inlineError}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            form.reset(toDefaults(v));
          }}
          className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
        >
          Batal
        </button>
        <button
          type="submit"
          disabled={patch.isPending}
          className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {patch.isPending ? 'Menyimpan…' : 'Simpan draft'}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-sm">{children}</p>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyForm = ReturnType<typeof useForm<any>>;

function Input({
  label,
  name,
  form,
  transformIn,
  transformOut,
}: {
  label: string;
  name: string;
  form: AnyForm;
  transformIn?: (v: unknown) => string;
  transformOut?: (s: string) => unknown;
}): JSX.Element {
  const raw = form.watch(name);
  const displayed = transformIn ? transformIn(raw) : String(raw ?? '');
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium">{label}</span>
      <input
        type="text"
        value={displayed}
        onChange={(e) =>
          form.setValue(
            name,
            transformOut ? transformOut(e.target.value) : e.target.value,
            { shouldDirty: true },
          )
        }
        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {form.formState.errors[name] && (
        <span role="alert" className="text-xs text-destructive">
          {String(form.formState.errors[name]?.message ?? '')}
        </span>
      )}
    </label>
  );
}

function TextArea({
  label,
  name,
  form,
  rows,
}: {
  label: string;
  name: string;
  form: AnyForm;
  rows: number;
}): JSX.Element {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium">{label}</span>
      <textarea
        rows={rows}
        {...form.register(name, {
          setValueAs: (v: unknown) => {
            if (typeof v !== 'string') return v ?? null;
            const trimmed = v.trim();
            return trimmed.length === 0 ? null : v;
          },
        })}
        className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
      {form.formState.errors[name] && (
        <span role="alert" className="text-xs text-destructive">
          {String(form.formState.errors[name]?.message ?? '')}
        </span>
      )}
    </label>
  );
}
