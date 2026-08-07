'use client';

/**
 * Self-service opt-in / opt-out card for the ADR-0041
 * "supervisor-can-ask-my-location" feature.
 *
 * # Visibility matrix
 *
 *   tenantEnabled = false               → "belum tersedia" info card
 *   tenantEnabled + !eligible           → "HR belum menandai Anda…" card
 *   tenantEnabled + eligible + !consent → OPT-IN form (shows full copy)
 *   tenantEnabled + eligible + consent  → OPT-OUT card + "your consent
 *                                         is pinned to SHA …" trace
 *   consent SHA drift                   → forced re-acceptance banner
 *
 * # Consent copy is source-of-truth
 *
 * The copy body + SHA come from `@workpulse/shared-types` — same file
 * the server hashes when validating opt-in. Displaying anything else
 * would make the SHA lie.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOCATION_SHARING_CONSENT_COPY,
  type LocationSharingSelfStatus,
} from '@workpulse/shared-types';
import { AlertTriangle, MapPin, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, locationSharingApi } from '@/lib/api-client';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function LocationSharingConsentPanel(): JSX.Element {
  const qc = useQueryClient();
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = useQuery<LocationSharingSelfStatus>({
    queryKey: ['me', 'location-sharing'],
    queryFn: () => locationSharingApi.selfStatus(),
  });

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof locationSharingApi.updateConsent>[0]) =>
      locationSharingApi.updateConsent(body),
    onSuccess: async () => {
      setError(null);
      setAcknowledged(false);
      await qc.invalidateQueries({ queryKey: ['me', 'location-sharing'] });
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(code ?? (err instanceof Error ? err.message : 'Terjadi kesalahan.'));
    },
  });

  if (status.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Berbagi lokasi saat shift</CardTitle>
          <CardDescription>Memuat status persetujuan…</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (status.isError || !status.data) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Gagal memuat status berbagi lokasi</AlertTitle>
        <AlertDescription>
          {status.error instanceof ApiError
            ? status.error.code
            : (status.error as Error)?.message ?? 'Coba muat ulang halaman.'}
        </AlertDescription>
      </Alert>
    );
  }

  const s = status.data;
  const shaMatches = s.consentedCopySha === LOCATION_SHARING_CONSENT_COPY.id;
  const optedIn = s.consentedAt !== null && shaMatches;

  // ---------- Card 1: tenant hasn't enabled ---------------------------------

  if (!s.tenantEnabled) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Berbagi lokasi saat shift</CardTitle>
              <CardDescription>
                Fitur ini belum diaktifkan oleh admin organisasi Anda. Ketika aktif, supervisor
                dapat meminta lokasi Anda saat shift, dan Anda memutuskan setiap permintaan.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="shrink-0">
              Belum tersedia
            </Badge>
          </div>
        </CardHeader>
      </Card>
    );
  }

  // ---------- Card 2: eligible check ----------------------------------------

  if (!s.eligible) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Berbagi lokasi saat shift</CardTitle>
              <CardDescription>
                Fitur ini hanya berlaku untuk karyawan lapangan (field worker). HR belum
                menandai profil Anda sebagai field worker; hubungi HR bila Anda merasa penandaan
                perlu diubah.
              </CardDescription>
            </div>
            <Badge variant="secondary" className="shrink-0">
              Tidak berlaku
            </Badge>
          </div>
        </CardHeader>
      </Card>
    );
  }

  // ---------- Card 3: opted-in, current SHA -------------------------------

  if (optedIn) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Anda telah setuju berbagi lokasi
              </CardTitle>
              <CardDescription>
                Supervisor dapat meminta lokasi Anda saat shift. Anda tetap dapat menolak
                permintaan mana pun, dan setiap kali lokasi Anda dilihat, Anda akan menerima
                notifikasi.
              </CardDescription>
            </div>
            <Badge variant="success" className="shrink-0">
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                Aktif
              </span>
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            Persetujuan diberikan pada{' '}
            <span className="font-medium">
              {s.consentedAt ? dateFormatter.format(new Date(s.consentedAt)) : '—'}
            </span>{' '}
            terhadap copy versi <code>{s.consentedCopySha?.slice(0, 12)}…</code>.
          </p>
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ action: 'OPT_OUT' })}
          >
            {mutation.isPending ? 'Memproses…' : 'Cabut persetujuan'}
          </Button>
          <p className="text-muted-foreground text-xs">
            Mencabut persetujuan tidak berdampak pada penilaian kerja Anda. Semua permintaan yang
            sedang menunggu akan otomatis dibatalkan.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---------- Card 4: SHA drifted (need re-consent) -------------------------

  const shaDrifted = s.consentedAt !== null && !shaMatches;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Berbagi lokasi saat shift</CardTitle>
            <CardDescription>
              {shaDrifted
                ? 'Copy persetujuan telah direvisi — mohon baca ulang dan setujui kembali sebelum supervisor dapat meminta lokasi Anda.'
                : 'Fitur opsional. Baca ketentuannya dengan cermat sebelum menyetujui.'}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="shrink-0">
            Opsional
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {shaDrifted ? (
          <Alert variant="warning">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Persetujuan Anda sebelumnya sudah tidak berlaku</AlertTitle>
            <AlertDescription>
              Kami memperbarui teks persetujuan sejak Anda opt-in terakhir. Sesuai UU 27/2022,
              kami wajib meminta ulang persetujuan Anda terhadap teks baru.
            </AlertDescription>
          </Alert>
        ) : null}

        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Baca lengkap teks persetujuan
          </summary>
          <div className="text-muted-foreground mt-2 whitespace-pre-line text-sm leading-relaxed">
            {LOCATION_SHARING_CONSENT_COPY.text}
          </div>
          <p className="text-muted-foreground mt-3 text-xs">
            Versi copy: <code>{LOCATION_SHARING_CONSENT_COPY.id.slice(0, 16)}…</code>{' '}
            (disetujui Legal per <code>{LOCATION_SHARING_CONSENT_COPY.approvedOn}</code>).
          </p>
        </details>

        <div className="flex items-start gap-2 rounded-lg border p-3">
          <input
            id="consent-ack"
            type="checkbox"
            className="border-input mt-1 h-4 w-4 rounded"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <Label htmlFor="consent-ack" className="text-sm leading-snug">
            Saya telah membaca dan memahami teks persetujuan di atas. Saya setuju supervisor
            dapat mengirim permintaan lokasi kepada saya saat shift aktif, dengan syarat setiap
            permintaan dan setiap akses koordinat memberi notifikasi kepada saya.
          </Label>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          size="sm"
          disabled={!acknowledged || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              action: 'OPT_IN',
              consentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
            })
          }
        >
          {mutation.isPending ? 'Menyimpan…' : 'Saya setuju'}
        </Button>
      </CardContent>
    </Card>
  );
}
