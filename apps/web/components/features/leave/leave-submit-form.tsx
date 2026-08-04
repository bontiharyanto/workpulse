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
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Send,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState, type ChangeEvent, type JSX } from 'react';
import { useForm } from 'react-hook-form';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiError,
  attachmentsApi,
  leaveApi,
  leaveTypesApi,
  uploadFileWithPresign,
} from '@/lib/api-client';
import { cn } from '@/lib/utils';

/**
 * Employee-facing form to submit a new leave request.
 *
 * INVARIANTS preserved verbatim from rules/20 §2:
 *   - Attachment upload flow is server-signed:
 *       1. `attachmentsApi.presign()` → returns opaque `fileKey` + headers.
 *       2. `uploadFileWithPresign(file, presigned, onProgress)` — direct
 *          PUT to S3 with `presigned.requiredHeaders` verbatim.
 *       3. Submit sends `attachmentKey: presigned.fileKey`, never the
 *          filename, URL, or a client-constructed key.
 *   - Local MIME + size pre-check is UX only. Server also validates.
 *   - `attachmentKey` is `undefined` when the leave type doesn't
 *     require an attachment. Do not omit the field otherwise —
 *     Zod refinement enforces this.
 */

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

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    <Card>
      <CardHeader>
        <CardTitle>Ajukan Cuti</CardTitle>
        <p className="text-muted-foreground text-caption">
          Pilih jenis cuti, tentukan tanggal, dan lampirkan dokumen bila diperlukan.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="leaveTypeId">Jenis Cuti</Label>
            <Select
              value={form.watch('leaveTypeId') || undefined}
              onValueChange={(v) => form.setValue('leaveTypeId', v, { shouldValidate: true })}
              disabled={types.isLoading}
            >
              <SelectTrigger id="leaveTypeId">
                <SelectValue placeholder="— Pilih jenis cuti —" />
              </SelectTrigger>
              <SelectContent>
                {types.data?.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {t.requiresAttachment ? ' · butuh lampiran' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.leaveTypeId ? (
              <p role="alert" className="text-destructive text-caption">
                {form.formState.errors.leaveTypeId.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Tanggal Mulai</Label>
              <Input id="startDate" type="date" {...form.register('startDate')} />
              {form.formState.errors.startDate ? (
                <p role="alert" className="text-destructive text-caption">
                  {form.formState.errors.startDate.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">Tanggal Akhir</Label>
              <Input id="endDate" type="date" {...form.register('endDate')} />
              {form.formState.errors.endDate ? (
                <p role="alert" className="text-destructive text-caption">
                  {form.formState.errors.endDate.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="reason">Alasan</Label>
            <Textarea id="reason" rows={3} {...form.register('reason')} />
            {form.formState.errors.reason ? (
              <p role="alert" className="text-destructive text-caption">
                {form.formState.errors.reason.message}
              </p>
            ) : null}
          </div>

          {selectedType?.requiresAttachment ? (
            <div
              className={cn(
                'border-border space-y-3 rounded-lg border border-dashed p-4',
                uploaded && 'border-success/40 bg-success/5',
              )}
            >
              <div className="flex items-center gap-2">
                {uploaded ? (
                  <FileText className="text-success h-4 w-4" aria-hidden />
                ) : (
                  <Paperclip className="text-muted-foreground h-4 w-4" aria-hidden />
                )}
                <Label htmlFor="attachmentFile" className="mb-0">
                  Lampiran (surat dokter, dll.)
                </Label>
              </div>

              <Input
                id="attachmentFile"
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={uploading}
                className="cursor-pointer file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1 file:text-sm file:text-primary-foreground hover:file:opacity-90"
                onChange={(e) => {
                  void handleFileChange(e);
                }}
              />

              {uploading ? (
                <div className="space-y-1.5">
                  <Progress value={uploadPercent} />
                  <p className="text-muted-foreground text-caption inline-flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Mengunggah… {uploadPercent}%
                  </p>
                </div>
              ) : null}

              {uploaded && !uploading ? (
                <div className="flex items-center justify-between gap-2 text-caption">
                  <span className="text-success inline-flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    <span className="font-medium">{uploaded.filename}</span>
                    <span className="text-muted-foreground">
                      · {(uploaded.sizeBytes / 1024).toFixed(0)} KB
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={clearAttachment}
                    className="text-destructive inline-flex items-center gap-1 hover:underline"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                    Hapus
                  </button>
                </div>
              ) : null}

              <p className="text-muted-foreground text-caption">
                Format: JPG, PNG, WebP, PDF · maks {MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.
              </p>
            </div>
          ) : null}

          {submitError ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal mengajukan cuti</AlertTitle>
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          ) : null}

          {submitOk ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertTitle>{submitOk}</AlertTitle>
              <AlertDescription>
                Menunggu persetujuan supervisor · Anda akan mendapatkan notifikasi.
              </AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" disabled={submit.isPending || uploading}>
            <Send className="h-4 w-4" aria-hidden />
            {submit.isPending ? 'Mengirim…' : 'Ajukan cuti'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
