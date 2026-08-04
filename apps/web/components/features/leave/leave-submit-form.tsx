'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  attachmentContentTypeSchema,
  leaveRequestInputSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentContentType,
  type LeaveRequestInput,
} from '@workpulse/shared-types';
import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import {
  ApiError,
  attachmentsApi,
  leaveApi,
  leaveTypesApi,
  uploadFileWithPresign,
} from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Saldo cuti tidak cukup untuk rentang ini.',
  ZERO_BUSINESS_DAYS: 'Rentang tanggal tidak berisi hari kerja.',
  OVERLAPPING_REQUEST: 'Ada pengajuan lain yang bertabrakan dengan rentang ini.',
  ATTACHMENT_REQUIRED: 'Jenis cuti ini membutuhkan lampiran.',
  ATTACHMENT_KEY_INVALID: 'Lampiran tidak valid — silakan upload ulang.',
  INVALID_DATE_RANGE: 'Tanggal akhir sebelum tanggal mulai.',
  LEAVE_TYPE_NOT_FOUND: 'Jenis cuti tidak ditemukan.',
  CONTENT_TYPE_NOT_ALLOWED: 'Tipe berkas tidak diizinkan (hanya JPG/PNG/WebP/PDF).',
  FILE_TOO_LARGE: 'Berkas melebihi batas 5 MB.',
  STORAGE_NOT_CONFIGURED: 'Storage upload belum dikonfigurasi di server.',
};

interface UploadedAttachment {
  fileKey: string;
  filename: string;
  sizeBytes: number;
}

export function LeaveSubmitForm(): JSX.Element {
  const qc = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitOk, setSubmitOk] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploaded, setUploaded] = useState<UploadedAttachment | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const types = useQuery({
    queryKey: ['leave', 'types'],
    queryFn: () => leaveTypesApi.list(),
  });

  const form = useForm<LeaveRequestInput>({
    resolver: zodResolver(leaveRequestInputSchema),
    mode: 'onTouched',
    defaultValues: {
      leaveTypeId: '',
      startDate: '',
      endDate: '',
      reason: '',
      attachmentKey: undefined,
    },
  });

  const selectedTypeId = form.watch('leaveTypeId');
  const selectedType = useMemo(
    () => types.data?.find((t) => t.id === selectedTypeId) ?? null,
    [types.data, selectedTypeId],
  );

  const clearAttachment = (): void => {
    setUploaded(null);
    setUploadPercent(0);
    form.setValue('attachmentKey', undefined, { shouldValidate: true });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Local validation first — no network round-trip on obviously-invalid files.
    const parsedType = attachmentContentTypeSchema.safeParse(file.type);
    if (!parsedType.success) {
      setSubmitError('Tipe berkas tidak diizinkan (hanya JPG/PNG/WebP/PDF).');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSubmitError(`Berkas melebihi batas ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`);
      e.target.value = '';
      return;
    }

    setSubmitError(null);
    setUploaded(null);
    setUploading(true);
    setUploadPercent(0);
    try {
      const presigned = await attachmentsApi.presign({
        purpose: 'leave-attachment',
        contentType: parsedType.data as AttachmentContentType,
        sizeBytes: file.size,
        filename: file.name,
      });
      await uploadFileWithPresign(file, presigned, (p) => setUploadPercent(p.percent));
      setUploaded({ fileKey: presigned.fileKey, filename: file.name, sizeBytes: file.size });
      form.setValue('attachmentKey', presigned.fileKey, { shouldValidate: true });
    } catch (err) {
      if (err instanceof ApiError) setSubmitError(ERROR_COPY[err.code] ?? err.message);
      else if (err instanceof Error) setSubmitError(err.message);
      else setSubmitError('Upload lampiran gagal.');
      clearAttachment();
    } finally {
      setUploading(false);
    }
  };

  const submit = useMutation({
    mutationFn: (values: LeaveRequestInput) => leaveApi.submit(values),
    onSuccess: () => {
      setSubmitError(null);
      setSubmitOk('Pengajuan cuti berhasil dikirim.');
      form.reset();
      clearAttachment();
      void qc.invalidateQueries({ queryKey: ['leave'] });
    },
    onError: (err) => {
      setSubmitOk(null);
      if (err instanceof ApiError) setSubmitError(ERROR_COPY[err.code] ?? err.message);
      else if (err instanceof Error) setSubmitError(err.message);
      else setSubmitError('Terjadi kesalahan yang tidak terduga.');
    },
  });

  const onSubmit = form.handleSubmit((values) => submit.mutate(values));

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border p-6 shadow-sm" noValidate>
      <h2 className="text-lg font-medium">Ajukan Cuti</h2>

      <div className="space-y-1">
        <label htmlFor="leaveTypeId" className="text-sm font-medium">
          Jenis Cuti
        </label>
        <select
          id="leaveTypeId"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          disabled={types.isLoading}
          {...form.register('leaveTypeId')}
        >
          <option value="">— Pilih —</option>
          {types.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} {t.requiresAttachment ? '(butuh lampiran)' : ''}
            </option>
          ))}
        </select>
        {form.formState.errors.leaveTypeId && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.leaveTypeId.message}
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor="startDate" className="text-sm font-medium">
            Tanggal Mulai
          </label>
          <input
            id="startDate"
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...form.register('startDate')}
          />
          {form.formState.errors.startDate && (
            <p role="alert" className="text-xs text-destructive">
              {form.formState.errors.startDate.message}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label htmlFor="endDate" className="text-sm font-medium">
            Tanggal Akhir
          </label>
          <input
            id="endDate"
            type="date"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            {...form.register('endDate')}
          />
          {form.formState.errors.endDate && (
            <p role="alert" className="text-xs text-destructive">
              {form.formState.errors.endDate.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="reason" className="text-sm font-medium">
          Alasan
        </label>
        <textarea
          id="reason"
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          {...form.register('reason')}
        />
        {form.formState.errors.reason && (
          <p role="alert" className="text-xs text-destructive">
            {form.formState.errors.reason.message}
          </p>
        )}
      </div>

      {selectedType?.requiresAttachment && (
        <div className="space-y-2 rounded-md border border-dashed border-input p-3">
          <label htmlFor="attachmentFile" className="text-sm font-medium">
            Lampiran (surat dokter, dll.)
          </label>
          <input
            id="attachmentFile"
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-primary-foreground hover:file:opacity-90"
            disabled={uploading}
            onChange={(e) => {
              void handleFileChange(e);
            }}
          />
          {uploading && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">Mengunggah… {uploadPercent}%</p>
            </div>
          )}
          {uploaded && !uploading && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-emerald-700 dark:text-emerald-400">
                ✓ {uploaded.filename} ({(uploaded.sizeBytes / 1024).toFixed(0)} KB) berhasil diunggah
              </span>
              <button
                type="button"
                onClick={clearAttachment}
                className="text-destructive underline-offset-2 hover:underline"
              >
                Hapus
              </button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Format yang didukung: JPG, PNG, WebP, PDF. Maks {MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.
          </p>
        </div>
      )}

      {submitError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {submitError}
        </p>
      )}
      {submitOk && (
        <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          {submitOk}
        </p>
      )}

      <button
        type="submit"
        disabled={submit.isPending || uploading}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50"
      >
        {submit.isPending ? 'Mengirim...' : 'Ajukan'}
      </button>
    </form>
  );
}
