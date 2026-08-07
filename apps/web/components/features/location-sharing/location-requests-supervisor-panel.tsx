'use client';

/**
 * Supervisor dashboard for the ADR-0041 flow.
 *
 * # Data sources
 *
 *   - `locationSharingApi.outgoing()` — my last 25 asks and their state
 *   - `attendanceApi.teamToday()` — scope-safe list of my team (supervisor
 *     sees only their subordinates; HR sees the whole tenant). We reuse
 *     this instead of hitting `/admin/users` because supervisors don't
 *     have permission there.
 *
 * # Field-worker filtering
 *
 * The team list doesn't include `isFieldWorker` yet. Rather than balloon
 * the shared type, we let the user pick anyone in scope and rely on the
 * server to reject non-field-workers with a clean `TARGET_NOT_FIELD_WORKER`
 * error surfaced inline. This keeps the FE thin; the copy explains the
 * constraint above the form.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocationShareRequestDto } from '@workpulse/shared-types';
import { AlertTriangle, MapPin, Send } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError, attendanceApi, locationSharingApi } from '@/lib/api-client';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function LocationRequestsSupervisorPanel(): JSX.Element | null {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [targetUserId, setTargetUserId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canRequest =
    !!user && (user.role === 'SUPERVISOR' || user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  const team = useQuery({
    queryKey: ['attendance', 'team', 'today', 'for-location-picker'],
    queryFn: () => attendanceApi.teamToday({ date: today() }),
    enabled: canRequest,
    staleTime: 60_000,
  });

  const outgoing = useQuery({
    queryKey: ['location-sharing', 'outgoing'],
    queryFn: () => locationSharingApi.outgoing(25),
    enabled: canRequest,
    refetchInterval: 30_000,
  });

  const create = useMutation({
    mutationFn: (body: { targetUserId: string; reason: string }) =>
      locationSharingApi.create(body),
    onSuccess: async () => {
      setError(null);
      setReason('');
      setTargetUserId('');
      await qc.invalidateQueries({ queryKey: ['location-sharing', 'outgoing'] });
    },
    onError: (err: unknown) => {
      setError(errorCopy(err));
    },
  });

  if (!canRequest) return null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Buat permintaan baru</CardTitle>
          <CardDescription>
            Karyawan wajib memiliki flag <code>field worker</code> yang di-set HR dan telah opt-in
            di halaman &ldquo;Pengaturan &rarr; Privasi&rdquo;. Jika target belum memenuhi
            keduanya, sistem akan menolak permintaan dengan pesan yang jelas.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (!targetUserId || reason.trim().length < 5) return;
              create.mutate({ targetUserId, reason: reason.trim() });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="target-user">Karyawan</Label>
              <select
                id="target-user"
                className="border-input bg-background focus-visible:ring-ring flex h-9 w-full items-center rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                required
                disabled={team.isLoading}
              >
                <option value="">— Pilih karyawan —</option>
                {(team.data ?? []).map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.fullName}
                    {m.departmentName ? ` · ${m.departmentName}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Alasan (5–200 karakter)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
                minLength={5}
                maxLength={200}
                placeholder="Contoh: konfirmasi kehadiran di lokasi klien A"
              />
            </div>
            <Button
              type="submit"
              disabled={
                create.isPending || !targetUserId || reason.trim().length < 5
              }
            >
              <Send className="mr-1 h-4 w-4" />
              {create.isPending ? 'Mengirim…' : 'Kirim permintaan'}
            </Button>
          </form>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Riwayat permintaan Anda (25 terakhir)</CardTitle>
          <CardDescription>
            Klik baris untuk melihat detail. Membuka detail dari permintaan yang sudah dijawab
            akan mengirim notifikasi &ldquo;lokasi Anda dilihat&rdquo; kepada karyawan.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead>Alasan</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outgoing.isLoading ? (
                <RowsSkeleton />
              ) : outgoing.data && outgoing.data.length > 0 ? (
                outgoing.data.map((r) => <OutgoingRow key={r.id} row={r} />)
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5}>
                    <div className="text-muted-foreground py-8 text-center text-sm">
                      Belum ada permintaan. Buat satu di form di atas.
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function OutgoingRow({ row }: { row: LocationShareRequestDto }): JSX.Element {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.targetUserName}</TableCell>
      <TableCell className="text-muted-foreground max-w-[240px] truncate text-sm">
        {row.reason}
      </TableCell>
      <TableCell className="tabular-nums text-sm">
        {dateFormatter.format(new Date(row.createdAt))}
      </TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell className="text-right">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/team/location-requests/${row.id}` as Route}>
            <MapPin className="mr-1 h-3.5 w-3.5" />
            Detail
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: LocationShareRequestDto['status'] }): JSX.Element {
  if (status === 'RESPONDED') return <Badge variant="success">Dibagikan</Badge>;
  if (status === 'DECLINED') return <Badge variant="secondary">Ditolak</Badge>;
  if (status === 'CANCELLED') return <Badge variant="secondary">Dibatalkan</Badge>;
  if (status === 'EXPIRED') return <Badge variant="secondary">Hangus</Badge>;
  return <Badge variant="warning">Menunggu</Badge>;
}

function RowsSkeleton(): JSX.Element {
  return (
    <>
      {Array.from({ length: 3 }).map((_, i) => (
        <TableRow key={i} className="hover:bg-transparent">
          {Array.from({ length: 5 }).map((__, j) => (
            <TableCell key={j}>
              <Skeleton className="h-4 w-full max-w-[120px]" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function errorCopy(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  switch (code) {
    case 'TARGET_NOT_FIELD_WORKER':
      return 'Karyawan ini belum ditandai sebagai field worker oleh HR. Fitur berbagi lokasi hanya berlaku untuk field worker.';
    case 'TARGET_NOT_OPTED_IN':
      return 'Karyawan ini belum meng-opt-in di halaman Pengaturan → Privasi.';
    case 'TARGET_CONSENT_STALE':
      return 'Karyawan ini opt-in atas copy persetujuan versi lama. Mereka perlu menyetujui ulang copy terbaru.';
    case 'DAILY_QUOTA_EXCEEDED':
      return 'Kuota harian permintaan lokasi untuk karyawan ini sudah habis (maksimal 6/24 jam). Coba lagi besok.';
    case 'PENDING_REQUEST_ALREADY_EXISTS':
      return 'Ada permintaan lain yang masih menunggu jawaban dari karyawan ini. Tunggu hasilnya atau batalkan permintaan yang lama.';
    case 'FEATURE_NOT_ENABLED':
      return 'Fitur berbagi lokasi belum diaktifkan admin organisasi Anda.';
    case 'NOT_MY_SUBORDINATE':
      return 'Karyawan ini bukan bagian dari tim langsung Anda.';
    case 'CANNOT_ASK_SELF':
      return 'Anda tidak dapat meminta lokasi Anda sendiri.';
    default:
      return code ?? (err instanceof Error ? err.message : 'Terjadi kesalahan.');
  }
}

function today(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
