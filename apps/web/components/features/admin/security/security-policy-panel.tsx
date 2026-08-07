'use client';

/**
 * SUPER_ADMIN-only tenant security policy editor.
 *
 * Currently exposes one toggle — `mfaEnforceHighPrivileged` — but is
 * intentionally structured around a `<PolicyToggle>` primitive so
 * new booleans (session idle timeout, password rotation, etc.) can
 * be added without a re-layout.
 *
 * # Interaction contract
 *
 * 1. Toggle flips the local state optimistically.
 * 2. An `AlertDialog` confirmation intercepts the flip because the
 *    security consequences are non-trivial (turning enforcement on
 *    can 403 every HR/Admin without MFA on their very next
 *    request; turning it off relaxes the tenant's posture and is
 *    audit-relevant).
 * 3. On confirm we PATCH and let React Query refetch the row.
 * 4. Errors surface in an inline banner — the toggle reverts.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LOCATION_SHARING_CONSENT_COPY,
  type SecurityPolicyDto,
} from '@workpulse/shared-types';
import { AlertTriangle, MapPin, ShieldCheck, ShieldOff } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError, securityPolicyApi } from '@/lib/api-client';

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'long',
  timeStyle: 'short',
});

export function SecurityPolicyPanel(): JSX.Element {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<null | {
    field: 'mfaEnforceHighPrivileged';
    next: boolean;
  }>(null);
  const [locationPending, setLocationPending] = useState<null | {
    action: 'ENABLE' | 'DISABLE';
    dpiaId?: string;
  }>(null);
  const [dpiaIdDraft, setDpiaIdDraft] = useState('');

  // Self-lockout warning: if the current SUPER_ADMIN doesn't have MFA
  // enrolled and turns enforcement ON, the guard's cache invalidation
  // is immediate, so their very next request (including PATCH-ing back
  // to OFF) fails with `MFA_ENROLLMENT_REQUIRED`. We surface this
  // explicitly so they don't lock themselves out unintentionally.
  const wouldSelfLockOut = user?.mfaEnabled !== true;

  const policy = useQuery<SecurityPolicyDto>({
    queryKey: ['admin', 'security-policy'],
    queryFn: () => securityPolicyApi.get(),
  });

  const mutation = useMutation({
    mutationFn: (body: Parameters<typeof securityPolicyApi.update>[0]) =>
      securityPolicyApi.update(body),
    onSuccess: (fresh) => {
      qc.setQueryData(['admin', 'security-policy'], fresh);
      setError(null);
    },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code ?? (err instanceof Error ? err.message : 'Terjadi kesalahan yang tidak terduga.'),
      );
    },
  });

  if (policy.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kebijakan keamanan tenant</CardTitle>
          <CardDescription>Memuat kebijakan aktif…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (policy.isError || !policy.data) {
    const code =
      policy.error instanceof ApiError ? policy.error.code : (policy.error as Error)?.message;
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Gagal memuat kebijakan keamanan</AlertTitle>
        <AlertDescription>
          {code ?? 'Terjadi kesalahan tidak terduga. Coba muat ulang halaman.'}
        </AlertDescription>
      </Alert>
    );
  }

  const current = policy.data;

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Perubahan gagal disimpan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Multi-Factor Authentication (MFA)</CardTitle>
              <CardDescription>
                Default tenant: <span className="font-medium">opsional</span> (belum dipaksa).
                Nyalakan toggle di bawah hanya saat organisasi siap mewajibkan MFA untuk{' '}
                <span className="font-medium">HR Manager</span> dan{' '}
                <span className="font-medium">Super Admin</span>.
              </CardDescription>
            </div>
            <Badge
              variant={current.mfaEnforceHighPrivileged ? 'success' : 'secondary'}
              className="shrink-0"
            >
              {current.mfaEnforceHighPrivileged ? (
                <span className="flex items-center gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Aktif
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <ShieldOff className="h-3.5 w-3.5" />
                  Opsional
                </span>
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="space-y-1">
              <Label htmlFor="mfa-enforce-switch" className="text-sm font-medium">
                Paksa enroll MFA untuk HR & Super Admin
              </Label>
              <p className="text-muted-foreground text-xs">
                Bila diaktifkan, semua HR/Super Admin yang belum mengenrol MFA akan diarahkan ke{' '}
                <code>/setup-mfa</code> pada request berikutnya dan tidak dapat menggunakan aplikasi
                sampai selesai enrol. Pengguna dengan MFA yang sudah aktif tidak terdampak.
              </p>
              <p className="text-muted-foreground text-xs">
                Karyawan &amp; Supervisor tetap opsional — mereka dapat mengenrol sendiri lewat{' '}
                <code>/settings/security</code>.
              </p>
            </div>
            <Switch
              id="mfa-enforce-switch"
              checked={current.mfaEnforceHighPrivileged}
              disabled={mutation.isPending}
              onCheckedChange={(next) => {
                setError(null);
                setPending({ field: 'mfaEnforceHighPrivileged', next });
              }}
            />
          </div>

          <p className="text-muted-foreground text-xs">
            Terakhir diubah:{' '}
            <span className="font-medium">{dateFormatter.format(new Date(current.updatedAt))}</span>
            {current.updatedById ? (
              <>
                {' '}
                oleh <code>{current.updatedById}</code>
              </>
            ) : (
              ' (nilai default)'
            )}
            . Perubahan tercatat di <code>audit_logs</code> dengan action{' '}
            <code>SECURITY_POLICY_UPDATED</code>.
          </p>
        </CardContent>
      </Card>

      {/* ADR-0041 — Location sharing rollout gate. */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Berbagi lokasi saat shift (ADR-0041)</CardTitle>
              <CardDescription>
                Memungkinkan supervisor mengirim <span className="font-medium">satu</span>{' '}
                permintaan lokasi kepada karyawan yang ditandai <code>isFieldWorker</code>.
                Karyawan tetap harus menyetujui, dan mendapat notifikasi setiap kali koordinatnya
                dilihat. Silent tracking tidak didukung.
              </CardDescription>
            </div>
            <Badge
              variant={current.locationSharingEnabled ? 'success' : 'secondary'}
              className="shrink-0"
            >
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {current.locationSharingEnabled ? 'Aktif' : 'Nonaktif'}
              </span>
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {current.locationSharingEnabled ? (
            <div className="rounded-lg border p-4 space-y-2">
              <p className="text-sm">
                Fitur aktif sejak{' '}
                <span className="font-medium">
                  {current.locationSharingEnabledAt
                    ? dateFormatter.format(new Date(current.locationSharingEnabledAt))
                    : '—'}
                </span>
                {current.locationSharingEnabledById ? (
                  <>
                    {' '}
                    (diaktifkan oleh <code>{current.locationSharingEnabledById}</code>).
                  </>
                ) : (
                  '.'
                )}
              </p>
              <p className="text-muted-foreground text-xs">
                DPIA gate:{' '}
                <code className="break-all">{current.locationSharingDpiaId ?? '—'}</code>
                <br />
                Consent copy SHA yang disetujui:{' '}
                <code className="break-all">
                  {current.locationSharingConsentCopySha ?? '—'}
                </code>
              </p>
              {current.locationSharingConsentCopySha &&
              current.locationSharingConsentCopySha !== LOCATION_SHARING_CONSENT_COPY.id ? (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Consent copy telah direvisi</AlertTitle>
                  <AlertDescription>
                    Copy persetujuan versi baru sudah dirilis (SHA{' '}
                    <code>{LOCATION_SHARING_CONSENT_COPY.id.slice(0, 12)}…</code>). Nonaktifkan
                    fitur, dapatkan approval Legal untuk copy baru, lalu aktifkan kembali agar
                    pencatatan compliance selalu merujuk copy terbaru.
                  </AlertDescription>
                </Alert>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => setLocationPending({ action: 'DISABLE' })}
              >
                Nonaktifkan fitur
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border p-4 space-y-3">
              <p className="text-sm">
                Fitur belum diaktifkan. Untuk mengaktifkan, siapkan:
              </p>
              <ol className="text-muted-foreground list-decimal pl-5 text-sm space-y-1">
                <li>DPIA dengan status <code>APPROVED</code> untuk aktivitas{' '}
                  <code>location-sharing</code>.</li>
                <li>Review Legal terhadap consent copy versi{' '}
                  <code>{LOCATION_SHARING_CONSENT_COPY.id.slice(0, 12)}…</code>{' '}
                  (per <code>{LOCATION_SHARING_CONSENT_COPY.approvedOn}</code>).</li>
              </ol>
              <div className="space-y-2">
                <Label htmlFor="dpia-id">DPIA ID</Label>
                <Input
                  id="dpia-id"
                  placeholder="dpia-xxxxxxxx"
                  value={dpiaIdDraft}
                  onChange={(e) => setDpiaIdDraft(e.target.value)}
                  disabled={mutation.isPending}
                />
              </div>
              <Button
                size="sm"
                disabled={mutation.isPending || dpiaIdDraft.trim().length === 0}
                onClick={() =>
                  setLocationPending({ action: 'ENABLE', dpiaId: dpiaIdDraft.trim() })
                }
              >
                Aktifkan fitur
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.next
                ? 'Aktifkan MFA wajib untuk HR & Super Admin?'
                : 'Nonaktifkan MFA wajib untuk HR & Super Admin?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {pending?.next ? (
                <div className="space-y-2">
                  <p>
                    Semua HR Manager dan Super Admin yang belum mengenrol MFA akan diarahkan ke{' '}
                    <code>/setup-mfa</code> pada request berikutnya. Pastikan tim Anda sudah siap
                    dan mendapat pemberitahuan sebelum melanjutkan.
                  </p>
                  {wouldSelfLockOut ? (
                    <p className="text-destructive font-medium">
                      Peringatan: akun Anda sendiri belum memiliki MFA. Setelah konfirmasi, Anda
                      juga akan diarahkan ke <code>/setup-mfa</code> dan tidak dapat mengubah toggle
                      ini lagi sampai selesai enrol. Enrol MFA dulu di{' '}
                      <code>/settings/security</code> sebelum melanjutkan.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    Kebijakan enforcement dihapus. HR dan Super Admin yang belum mengenrol MFA masih
                    dapat login tanpa faktor kedua. Perubahan ini menurunkan postur keamanan tenant
                    Anda dan akan tercatat di audit log.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (!pending) return;
                mutation.mutate(
                  { [pending.field]: pending.next },
                  {
                    onSettled: () => setPending(null),
                  },
                );
              }}
            >
              {mutation.isPending ? 'Menyimpan…' : 'Konfirmasi'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={locationPending !== null}
        onOpenChange={(open) => {
          if (!open) setLocationPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {locationPending?.action === 'ENABLE'
                ? 'Aktifkan berbagi lokasi saat shift?'
                : 'Nonaktifkan berbagi lokasi saat shift?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              {locationPending?.action === 'ENABLE' ? (
                <div className="space-y-2">
                  <p>
                    Fitur akan tersedia untuk semua supervisor + karyawan{' '}
                    <code>isFieldWorker</code> yang telah opt-in. Perubahan tercatat sebagai{' '}
                    <code>LOCATION_SHARING_ENABLED</code> di audit log, membawa DPIA id + SHA
                    consent copy — artefak yang biasa diminta regulator.
                  </p>
                  <p className="text-muted-foreground text-xs">
                    DPIA <code>{locationPending?.dpiaId}</code> akan divalidasi (harus{' '}
                    <code>APPROVED</code> dan aktivitas <code>location-sharing</code>) sebelum
                    perubahan disimpan.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <p>
                    Semua request PENDING akan tetap ada tapi tidak dapat direspon (target user
                    tidak melihat lagi). Supervisor tidak dapat membuat request baru. Metadata
                    DPIA + SHA disimpan agar &quot;pernah pernah aktif&quot; tetap dapat
                    dijawab.
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>Batal</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (!locationPending) return;
                const body =
                  locationPending.action === 'ENABLE'
                    ? {
                        locationSharing: {
                          action: 'ENABLE' as const,
                          dpiaId: locationPending.dpiaId ?? '',
                          consentCopySha: LOCATION_SHARING_CONSENT_COPY.id,
                        },
                      }
                    : { locationSharing: { action: 'DISABLE' as const } };
                mutation.mutate(body, {
                  onSettled: () => {
                    setLocationPending(null);
                    setDpiaIdDraft('');
                  },
                });
              }}
            >
              {mutation.isPending ? 'Menyimpan…' : 'Konfirmasi'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
