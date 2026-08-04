'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ExportShareRow,
  ExportTimesheetInput,
  TimesheetExportFormat,
  TimesheetExportMode,
} from '@workpulse/shared-types';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  Inbox,
  Link as LinkIcon,
  Share2,
  X,
} from 'lucide-react';
import { useMemo, useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, saveBlob, timesheetAdminApi, timesheetExportApi } from '@/lib/api-client';

/**
 * `/admin/timesheet/exports` panel.
 *
 * INVARIANTS (rules/20 §6, timesheet workflow):
 * - Only APPROVED timesheets are exported (server-enforced;
 *   `EXPORT_EMPTY` if none). We don't pre-filter on the FE.
 * - Payload + SHA-256 hash + audit row are computed/appended
 *   server-side inside the same transaction; the FE only renders
 *   the truncated hash preview.
 * - Signed share URLs are opaque tokens returned by the server.
 *   TTL is validated 1..168 hours by the API.
 * - Throttle 10/min on export is applied server-side.
 */
const ERROR_COPY: Record<string, string> = {
  EXPORT_EMPTY: 'Tidak ada timesheet APPROVED pada periode & filter tersebut.',
  TIMESHEET_PERIOD_NOT_FOUND: 'Periode tidak ditemukan.',
  DEPARTMENT_NOT_FOUND: 'Departemen tidak valid.',
  THROTTLED: 'Terlalu banyak percobaan export. Coba lagi sebentar.',
  SHARE_TTL_OUT_OF_RANGE: 'TTL harus 1..168 jam.',
  EXPORT_PAYLOAD_UNAVAILABLE:
    'File export ini sudah tidak dapat dibagikan (dibuat sebelum fitur signed URL). Buat export baru.',
  EXPORT_NOT_FOUND: 'Export tidak ditemukan.',
  SHARE_NOT_FOUND: 'Link tidak ditemukan.',
};

export function TimesheetExportsPanel(): JSX.Element {
  const qc = useQueryClient();

  const periods = useQuery({
    queryKey: ['timesheet-periods'],
    queryFn: () => timesheetAdminApi.periods(),
    staleTime: 30_000,
  });
  const auditRows = useQuery({
    queryKey: ['timesheet-exports-list'],
    queryFn: () => timesheetExportApi.list(50),
  });

  const [form, setForm] = useState<ExportTimesheetInput>({
    periodId: '',
    format: 'XLSX',
    mode: 'SUMMARY',
    departmentId: null,
    note: '',
  });

  const runExport = useMutation({
    mutationFn: async () => {
      const result = await timesheetExportApi.create({
        ...form,
        note: form.note?.trim() ? form.note.trim() : null,
        departmentId: form.departmentId || null,
      });
      saveBlob(result);
      return result;
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['timesheet-exports-list'] });
    },
  });

  const inlineError = useMemo(() => {
    if (!runExport.error) return null;
    if (runExport.error instanceof ApiError) {
      return ERROR_COPY[runExport.error.code] ?? runExport.error.message;
    }
    return 'Gagal export timesheet.';
  }, [runExport.error]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Export payroll</CardTitle>
          <p className="text-muted-foreground text-caption">
            Hanya timesheet berstatus <span className="text-foreground font-medium">APPROVED</span>{' '}
            yang akan diekspor. Setiap ekspor tercatat pada audit trail.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="ts-export-period">Periode</Label>
            <Select
              value={form.periodId || undefined}
              onValueChange={(v) => setForm((f) => ({ ...f, periodId: v }))}
            >
              <SelectTrigger id="ts-export-period" data-testid="ts-export-period">
                <SelectValue placeholder="— Pilih periode —" />
              </SelectTrigger>
              <SelectContent>
                {(periods.data?.items ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label} ({p.periodStart} → {p.periodEnd})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ts-export-format">Format</Label>
              <Select
                value={form.format}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, format: v as TimesheetExportFormat }))
                }
              >
                <SelectTrigger id="ts-export-format" data-testid="ts-export-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="XLSX">Excel (XLSX)</SelectItem>
                  <SelectItem value="CSV">CSV (RFC-4180, BOM)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ts-export-mode">Mode</Label>
              <Select
                value={form.mode}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, mode: v as TimesheetExportMode }))
                }
              >
                <SelectTrigger id="ts-export-mode" data-testid="ts-export-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SUMMARY">Summary (1 baris / user)</SelectItem>
                  <SelectItem value="DETAIL">Detail (1 baris / hari)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ts-export-note">Catatan (opsional)</Label>
            <Input
              id="ts-export-note"
              type="text"
              maxLength={200}
              value={form.note ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="mis. Payroll batch Agustus"
            />
          </div>

          <Button
            onClick={() => runExport.mutate()}
            disabled={!form.periodId || runExport.isPending}
            data-testid="ts-export-submit"
          >
            <Download className="h-4 w-4" aria-hidden />
            {runExport.isPending ? 'Mengirim…' : 'Export & download'}
          </Button>

          {inlineError ? (
            <Alert variant="destructive" data-testid="ts-export-error">
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal export timesheet</AlertTitle>
              <AlertDescription>{inlineError}</AlertDescription>
            </Alert>
          ) : null}
          {runExport.isSuccess ? (
            <Alert variant="success">
              <CheckCircle2 aria-hidden />
              <AlertTitle>Export berhasil</AlertTitle>
              <AlertDescription>File terunduh &amp; audit log tercatat.</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat export</CardTitle>
          <p className="text-muted-foreground text-caption">
            Audit trail append-only. Klik <span className="text-foreground font-medium">Bagikan</span>{' '}
            untuk membuat link download bertanda tangan yang bisa dikirim ke vendor payroll tanpa
            akun.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {auditRows.isLoading ? (
            <div className="space-y-3 p-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : (auditRows.data?.items ?? []).length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 py-12">
              <Inbox className="h-6 w-6" aria-hidden />
              <p className="text-body text-foreground">Belum ada export</p>
              <p className="text-caption">Buat export pertama di panel sebelah kiri.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead>Format / Mode</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Bytes</TableHead>
                  <TableHead>Oleh</TableHead>
                  <TableHead>SHA-256</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(auditRows.data?.items ?? []).map((r) => (
                  <ExportRow key={r.id} row={r} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// ---------------------------------------------------------------------------
// Export row + Share dialog
// ---------------------------------------------------------------------------

type ExportRowData = {
  id: string;
  createdAt: string;
  period: { label: string; periodStart: string; periodEnd: string };
  format: string;
  mode: string;
  rowCount: number;
  entryCount: number;
  bytes: number;
  requestedBy: { fullName: string; email: string };
  payloadSha256: string;
};

function ExportRow({ row: r }: { row: ExportRowData }): JSX.Element {
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <>
      <TableRow>
        <TableCell className="font-mono text-caption tabular-nums">
          {r.createdAt.replace('T', ' ').slice(0, 19)}
        </TableCell>
        <TableCell>
          <div className="text-body">{r.period.label}</div>
          <div className="text-muted-foreground text-caption tabular-nums">
            {r.period.periodStart} → {r.period.periodEnd}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="muted">{r.format}</Badge>
            <Badge variant="outline">{r.mode}</Badge>
          </div>
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">
          {r.rowCount}
          {r.mode === 'DETAIL' ? ` · ${r.entryCount}` : ''}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{formatBytes(r.bytes)}</TableCell>
        <TableCell>
          <div className="text-body">{r.requestedBy.fullName}</div>
          <div className="text-muted-foreground text-caption">{r.requestedBy.email}</div>
        </TableCell>
        <TableCell className="text-muted-foreground font-mono text-caption">
          {r.payloadSha256.slice(0, 16)}…
        </TableCell>
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShareOpen(true)}
            data-testid={`ts-share-${r.id}`}
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
            Bagikan
          </Button>
        </TableCell>
      </TableRow>

      <ShareDialog
        exportId={r.id}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
}

function ShareDialog({
  exportId,
  open,
  onOpenChange,
}: {
  exportId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [ttlHours, setTtlHours] = useState<number>(24);
  const [note, setNote] = useState<string>('');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ['timesheet-export-shares', exportId],
    queryFn: () => timesheetExportApi.listShares(exportId),
    enabled: open,
  });

  const createShare = useMutation({
    mutationFn: () =>
      timesheetExportApi.createShare(exportId, {
        ttlHours,
        note: note.trim() || null,
      }),
    onSuccess: async (data) => {
      setFreshUrl(data.url);
      setNote('');
      await qc.invalidateQueries({
        queryKey: ['timesheet-export-shares', exportId],
      });
    },
  });

  const revokeShare = useMutation({
    mutationFn: (shareId: string) => timesheetExportApi.revokeShare(exportId, shareId),
    onSuccess: async () => {
      await qc.invalidateQueries({
        queryKey: ['timesheet-export-shares', exportId],
      });
    },
  });

  const createError = useMemo(() => {
    if (!createShare.error) return null;
    if (createShare.error instanceof ApiError) {
      return ERROR_COPY[createShare.error.code] ?? createShare.error.message;
    }
    return 'Gagal membuat link.';
  }, [createShare.error]);

  const copyToClipboard = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Ignored — user will fall back to manual copy.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bagikan link download</DialogTitle>
          <DialogDescription>
            Buat signed URL untuk vendor payroll. Link akan expire otomatis sesuai TTL.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[100px_1fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`ts-share-ttl-${exportId}`}>TTL (jam)</Label>
              <Input
                id={`ts-share-ttl-${exportId}`}
                type="number"
                min={1}
                max={168}
                value={ttlHours}
                onChange={(e) => setTtlHours(Number(e.target.value))}
                data-testid={`ts-share-ttl-${exportId}`}
                className="tabular-nums"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`ts-share-note-${exportId}`}>Catatan (opsional)</Label>
              <Input
                id={`ts-share-note-${exportId}`}
                type="text"
                maxLength={200}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="mis. shared dengan Vendor A"
              />
            </div>
            <Button
              onClick={() => createShare.mutate()}
              disabled={createShare.isPending}
              data-testid={`ts-share-create-${exportId}`}
            >
              <LinkIcon className="h-4 w-4" aria-hidden />
              {createShare.isPending ? 'Membuat…' : 'Buat link'}
            </Button>
          </div>

          {createError ? (
            <Alert variant="destructive" data-testid={`ts-share-error-${exportId}`}>
              <AlertTriangle aria-hidden />
              <AlertTitle>Gagal membuat link</AlertTitle>
              <AlertDescription>{createError}</AlertDescription>
            </Alert>
          ) : null}

          {freshUrl ? (
            <Alert variant="success" data-testid={`ts-share-fresh-${exportId}`}>
              <CheckCircle2 aria-hidden />
              <AlertTitle>Link berhasil dibuat</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>Bagikan segera ke vendor:</p>
                <div className="bg-background border-border flex items-center gap-2 rounded-md border p-2">
                  <code className="text-caption flex-1 truncate">{freshUrl}</code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void copyToClipboard(freshUrl);
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden />
                    Salin
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-2">
            <h4 className="text-muted-foreground text-overline uppercase">Riwayat link</h4>
            {shares.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-md" />
                ))}
              </div>
            ) : (shares.data?.items ?? []).length === 0 ? (
              <p className="text-muted-foreground text-caption border-border rounded-md border border-dashed p-4 text-center">
                Belum ada link untuk export ini.
              </p>
            ) : (
              <ul className="border-border divide-border divide-y rounded-md border">
                {(shares.data?.items ?? []).map((s) => (
                  <ShareRow
                    key={s.id}
                    share={s}
                    onRevoke={() => revokeShare.mutate(s.id)}
                    revoking={revokeShare.isPending}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareRow({
  share,
  onRevoke,
  revoking,
}: {
  share: ExportShareRow;
  onRevoke: () => void;
  revoking: boolean;
}): JSX.Element {
  const badge = share.active ? (
    <Badge variant="success">Aktif</Badge>
  ) : share.revokedAt ? (
    <Badge variant="destructive">Dicabut</Badge>
  ) : (
    <Badge variant="muted">Expired</Badge>
  );

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-caption">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          {badge}
          <span className="text-muted-foreground tabular-nums">
            Kadaluarsa {share.expiresAt.replace('T', ' ').slice(0, 16)}
          </span>
        </div>
        <div className="text-muted-foreground">
          Dibuat <span className="tabular-nums">{share.createdAt.replace('T', ' ').slice(0, 16)}</span>{' '}
          oleh {share.createdBy.email} · {share.downloadCount} unduhan
          {share.note ? ` · "${share.note}"` : ''}
        </div>
      </div>
      {share.active ? (
        <Button
          size="sm"
          variant="outline"
          onClick={onRevoke}
          disabled={revoking}
          data-testid={`ts-share-revoke-${share.id}`}
          className="border-destructive/50 text-destructive hover:bg-destructive/5"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Cabut
        </Button>
      ) : null}
    </li>
  );
}
