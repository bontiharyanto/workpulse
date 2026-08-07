'use client';

/**
 * Supervisor / HR view of a single ADR-0041 request.
 *
 * # Server-driven "viewed" notification
 *
 * Every server GET on this endpoint fires `LOCATION_SHARE_VIEWED` to
 * the target user when the request is RESPONDED. The FE does NOT need
 * to trigger this — we deliberately keep the accounting server-side
 * to prevent forged-off-record views. So no `on-mount ping` from here.
 *
 * # Map
 *
 * ADR-0042 (Track 3): the coordinate card now embeds an inline
 * MapLibre preview served by our own `/maps/*` endpoints. No more
 * out-links to openstreetmap.org — HR can eyeball the ping in
 * situ without leaking the coord to a third-party host.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocationShareRequestDto } from '@workpulse/shared-types';
import { AlertTriangle, ArrowLeft, Ban, MapPin } from 'lucide-react';
import type { Route } from 'next';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, locationSharingApi } from '@/lib/api-client';

// MapLibre touches `window` on import — dynamic import with SSR
// disabled keeps it out of the server bundle.
const InlineMapPreview = dynamic(
  () => import('@/components/features/maps/inline-map-preview').then((m) => m.InlineMapPreview),
  { ssr: false, loading: () => <div className="bg-muted h-[220px] w-full animate-pulse rounded-md" /> },
);

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function LocationRequestSupervisorDetail({
  requestId,
}: {
  requestId: string;
}): JSX.Element {
  const qc = useQueryClient();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useQuery<LocationShareRequestDto>({
    queryKey: ['location-sharing', 'request', requestId],
    queryFn: () => locationSharingApi.get(requestId),
  });

  const cancel = useMutation({
    mutationFn: () => locationSharingApi.cancel(requestId),
    onSuccess: async () => {
      setError(null);
      setCancelOpen(false);
      await qc.invalidateQueries({ queryKey: ['location-sharing', 'request', requestId] });
      await qc.invalidateQueries({ queryKey: ['location-sharing', 'outgoing'] });
    },
    onError: (err: unknown) =>
      setError(err instanceof ApiError ? err.code : (err as Error)?.message ?? 'Gagal membatalkan.'),
  });

  if (request.isLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (request.isError || !request.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Gagal memuat permintaan</AlertTitle>
        <AlertDescription>
          {request.error instanceof ApiError
            ? request.error.code
            : (request.error as Error)?.message ?? 'Coba muat ulang.'}
        </AlertDescription>
      </Alert>
    );
  }

  const req = request.data;
  const hasPing = req.ping !== null;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild>
        <Link href={'/team/location-requests' as Route}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Kembali ke daftar permintaan
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {req.targetUserName}
              </CardTitle>
              <CardDescription>
                Alasan: &ldquo;{req.reason}&rdquo; · Dibuat{' '}
                {dateFormatter.format(new Date(req.createdAt))}
              </CardDescription>
            </div>
            <StatusBadge status={req.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs">Kedaluwarsa</dt>
              <dd>{dateFormatter.format(new Date(req.expiresAt))}</dd>
            </div>
            {req.respondedAt ? (
              <div>
                <dt className="text-muted-foreground text-xs">Dijawab</dt>
                <dd>{dateFormatter.format(new Date(req.respondedAt))}</dd>
              </div>
            ) : null}
            {req.cancelledAt ? (
              <div>
                <dt className="text-muted-foreground text-xs">Dibatalkan</dt>
                <dd>{dateFormatter.format(new Date(req.cancelledAt))}</dd>
              </div>
            ) : null}
            {req.viewedAt ? (
              <div>
                <dt className="text-muted-foreground text-xs">Terakhir dilihat</dt>
                <dd>{dateFormatter.format(new Date(req.viewedAt))}</dd>
              </div>
            ) : null}
          </dl>

          {hasPing && req.ping ? (
            <Card className="border-primary/40 bg-primary/5">
              <CardHeader>
                <CardTitle className="text-base">Koordinat yang dibagikan</CardTitle>
                <CardDescription>
                  Dilaporkan pada {dateFormatter.format(new Date(req.ping.clientCapturedAt))}.
                  Data ini akan dihapus otomatis 7 hari setelah pengiriman sesuai kebijakan
                  retensi.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid gap-2 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-muted-foreground text-xs">Latitude</dt>
                    <dd className="tabular-nums">{req.ping.latitude.toFixed(6)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Longitude</dt>
                    <dd className="tabular-nums">{req.ping.longitude.toFixed(6)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Akurasi GPS</dt>
                    <dd className="tabular-nums">±{req.ping.accuracyMeters} m</dd>
                  </div>
                </dl>
                <InlineMapPreview
                  latitude={req.ping.latitude}
                  longitude={req.ping.longitude}
                  ariaLabel={`Peta lokasi ${req.targetUserName} pada ${req.ping.latitude.toFixed(5)}, ${req.ping.longitude.toFixed(5)}`}
                />
              </CardContent>
            </Card>
          ) : null}

          {req.status === 'RESPONDED' && !hasPing ? (
            <Alert>
              <AlertTitle>Koordinat sudah dihapus</AlertTitle>
              <AlertDescription>
                Karyawan pernah membagikan lokasi, tetapi data koordinat telah melewati batas
                retensi 7 hari dan otomatis dihapus dari sistem.
              </AlertDescription>
            </Alert>
          ) : null}

          {req.status === 'PENDING' ? (
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setCancelOpen(true)}
                disabled={cancel.isPending}
              >
                <Ban className="mr-1 h-4 w-4" />
                Batalkan permintaan
              </Button>
            </div>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Batalkan permintaan lokasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Karyawan {req.targetUserName} akan menerima notifikasi bahwa permintaan Anda
              dibatalkan. Anda dapat mengirim permintaan baru kapan saja.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {cancel.isPending ? 'Membatalkan…' : 'Ya, batalkan'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatusBadge({ status }: { status: LocationShareRequestDto['status'] }): JSX.Element {
  if (status === 'RESPONDED') return <Badge variant="success">Dibagikan</Badge>;
  if (status === 'DECLINED') return <Badge variant="secondary">Ditolak</Badge>;
  if (status === 'CANCELLED') return <Badge variant="secondary">Dibatalkan</Badge>;
  if (status === 'EXPIRED') return <Badge variant="secondary">Hangus</Badge>;
  return <Badge variant="warning">Menunggu</Badge>;
}
