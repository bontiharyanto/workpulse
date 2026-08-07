'use client';

/**
 * ADR-0041 — user-side respond flow.
 *
 * A single request row + accept/decline controls. Accept fires a
 * browser Geolocation prompt; decline is a one-click terminal state.
 * Deliberately server-authoritative: even if the user clicks accept,
 * the coord isn't materialised until the server's `respond` returns
 * 2xx (network drop → request stays PENDING and user can retry).
 *
 * # Why we don't pre-fetch geolocation
 *
 * The Geolocation API prompts the user for permission the first time
 * you call it. Firing that prompt on page mount before the user has
 * seen the request context is jarring and yields lots of "block" hits.
 * We only call `navigator.geolocation.getCurrentPosition` after they
 * explicitly click Accept.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { LocationShareRequestDto } from '@workpulse/shared-types';
import { AlertTriangle, Check, MapPin, ShieldOff, XCircle } from 'lucide-react';
import { useState, type JSX } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, locationSharingApi } from '@/lib/api-client';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface Coord {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  clientCapturedAt: string;
}

export function LocationShareRespondPanel({ requestId }: { requestId: string }): JSX.Element {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [geoInFlight, setGeoInFlight] = useState(false);

  const request = useQuery<LocationShareRequestDto>({
    queryKey: ['location-sharing', 'request', requestId],
    queryFn: () => locationSharingApi.get(requestId),
    refetchOnWindowFocus: true,
  });

  const respondMutation = useMutation({
    mutationFn: (body: Parameters<typeof locationSharingApi.respond>[1]) =>
      locationSharingApi.respond(requestId, body),
    onSuccess: async () => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['location-sharing', 'request', requestId] });
      await qc.invalidateQueries({ queryKey: ['location-sharing', 'inbox'] });
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(code ?? (err instanceof Error ? err.message : 'Terjadi kesalahan.'));
    },
  });

  if (request.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Memuat permintaan…</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (request.isError || !request.data) {
    const code = request.error instanceof ApiError ? request.error.code : undefined;
    return (
      <Alert variant="destructive">
        <ShieldOff className="h-4 w-4" />
        <AlertTitle>Permintaan tidak dapat dibuka</AlertTitle>
        <AlertDescription>
          {code === 'REQUEST_NOT_FOUND'
            ? 'Permintaan tidak ditemukan atau sudah dihapus. Kemungkinan sudah expired atau dibatalkan supervisor.'
            : code ?? (request.error as Error)?.message ?? 'Coba muat ulang halaman.'}
        </AlertDescription>
      </Alert>
    );
  }

  const req = request.data;
  const isPending = req.status === 'PENDING';
  const isExpired = new Date(req.expiresAt).getTime() <= Date.now();

  const handleAccept = async (): Promise<void> => {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('Perangkat Anda tidak mendukung deteksi lokasi.');
      return;
    }
    setGeoInFlight(true);
    try {
      const coord = await new Promise<Coord>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyMeters: Math.round(pos.coords.accuracy),
              clientCapturedAt: new Date(pos.timestamp).toISOString(),
            }),
          (err) => reject(err),
          {
            enableHighAccuracy: true,
            timeout: 15_000,
            maximumAge: 0,
          },
        );
      });
      await respondMutation.mutateAsync({
        outcome: 'ACCEPT',
        latitude: coord.latitude,
        longitude: coord.longitude,
        accuracyMeters: coord.accuracyMeters,
        clientCapturedAt: coord.clientCapturedAt,
      });
    } catch (err) {
      const gErr = err as GeolocationPositionError;
      if (gErr.code === 1) {
        setError('Anda menolak akses lokasi di browser. Coba lagi setelah memberi izin, atau tekan "Tolak" untuk menolak permintaan.');
      } else if (gErr.code === 3) {
        setError('Timeout — GPS Anda tidak merespons dalam 15 detik.');
      } else if (gErr.message) {
        setError(gErr.message);
      } else {
        setError('Tidak dapat mengambil lokasi.');
      }
    } finally {
      setGeoInFlight(false);
    }
  };

  const handleDecline = (): void => {
    respondMutation.mutate({ outcome: 'DECLINE' });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              {req.supervisorName} meminta lokasi Anda
            </CardTitle>
            <CardDescription>
              Dibuat pada {dateFormatter.format(new Date(req.createdAt))}. Alasan:{' '}
              <span className="text-foreground font-medium">&ldquo;{req.reason}&rdquo;</span>
            </CardDescription>
          </div>
          <StatusBadge status={req.status} isExpired={isExpired} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending && !isExpired ? (
          <>
            <Alert variant="info">
              <AlertTitle>Sebelum Anda memutuskan</AlertTitle>
              <AlertDescription>
                Aplikasi akan meminta izin GPS dari browser Anda saat Anda menekan &ldquo;Bagikan
                sekarang&rdquo;. Hanya satu titik koordinat yang dikirim, tidak ada pelacakan
                lanjutan. Permintaan hangus otomatis pada{' '}
                <span className="font-medium">{dateFormatter.format(new Date(req.expiresAt))}</span>
                .
              </AlertDescription>
            </Alert>

            {error ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={handleAccept}
                disabled={geoInFlight || respondMutation.isPending}
              >
                <Check className="mr-1 h-4 w-4" />
                {geoInFlight
                  ? 'Mengambil lokasi…'
                  : respondMutation.isPending
                    ? 'Mengirim…'
                    : 'Bagikan sekarang'}
              </Button>
              <Button
                variant="outline"
                onClick={handleDecline}
                disabled={geoInFlight || respondMutation.isPending}
              >
                <XCircle className="mr-1 h-4 w-4" />
                Tolak
              </Button>
            </div>
          </>
        ) : req.status === 'RESPONDED' ? (
          <Alert variant="success">
            <Check className="h-4 w-4" />
            <AlertTitle>Anda telah membagikan lokasi</AlertTitle>
            <AlertDescription>
              Koordinat dikirim pada{' '}
              {req.respondedAt ? dateFormatter.format(new Date(req.respondedAt)) : '—'}. Data ini
              akan dihapus otomatis dalam 7 hari. Anda akan menerima notifikasi jika supervisor
              atau HR melihat koordinat Anda.
            </AlertDescription>
          </Alert>
        ) : req.status === 'DECLINED' ? (
          <Alert>
            <XCircle className="h-4 w-4" />
            <AlertTitle>Anda telah menolak permintaan ini</AlertTitle>
            <AlertDescription>
              Tidak ada koordinat yang dikirim. Supervisor telah menerima notifikasi.
            </AlertDescription>
          </Alert>
        ) : req.status === 'EXPIRED' || isExpired ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Permintaan hangus</AlertTitle>
            <AlertDescription>
              Permintaan ini sudah lewat batas 15 menit. Supervisor perlu mengirim permintaan
              baru.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert>
            <AlertTitle>Permintaan dibatalkan</AlertTitle>
            <AlertDescription>
              Supervisor menarik kembali permintaan ini{' '}
              {req.cancelledAt ? `pada ${dateFormatter.format(new Date(req.cancelledAt))}` : ''}.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({
  status,
  isExpired,
}: {
  status: LocationShareRequestDto['status'];
  isExpired: boolean;
}): JSX.Element {
  if (status === 'RESPONDED') return <Badge variant="success">Sudah dibagikan</Badge>;
  if (status === 'DECLINED') return <Badge variant="secondary">Ditolak</Badge>;
  if (status === 'CANCELLED') return <Badge variant="secondary">Dibatalkan</Badge>;
  if (status === 'EXPIRED' || isExpired) return <Badge variant="secondary">Hangus</Badge>;
  return <Badge variant="warning">Menunggu keputusan</Badge>;
}
