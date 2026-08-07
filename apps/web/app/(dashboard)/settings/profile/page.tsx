'use client';

import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import type { JSX } from 'react';

import { RequireAuth } from '@/components/features/auth/require-auth';
import { useAuth } from '@/components/providers/auth-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

const ROLE_LABEL: Record<string, string> = {
  EMPLOYEE: 'Karyawan',
  SUPERVISOR: 'Supervisor',
  HR_MANAGER: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
};

/**
 * `/settings/profile` — read-only view of the identity fields carried
 * on the current session (`AuthenticatedUser`). The single source of
 * truth is the server; edits are performed by HR from
 * `/admin/users` (rules/20 §3: privileged mutations stay behind
 * the server-side RBAC guard).
 */
export default function ProfileSettingsPage(): JSX.Element {
  return (
    <RequireAuth>
      <ProfileContent />
    </RequireAuth>
  );
}

function ProfileContent(): JSX.Element {
  const { user, status } = useAuth();

  if (status === 'loading' || !user) {
    return (
      <div className="text-muted-foreground text-body flex items-center gap-2 py-6">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        <span>Memuat profil…</span>
      </div>
    );
  }

  const roleLabel = ROLE_LABEL[user.role] ?? user.role;

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-h4 text-foreground tracking-tight">Profil</h2>
        <p className="text-muted-foreground text-body">
          Informasi identitas yang terhubung dengan akun Anda. Perubahan data personal dilakukan
          oleh HR melalui menu Admin.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Identitas akun</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" value={user.email} mono />
          <Field label="Peran" value={roleLabel} />
          <Field label="ID pengguna" value={user.id} mono />
          <Field label="Tenant" value={user.companyId} mono />
          <Field label="Departemen" value={user.departmentId ?? '—'} mono />
          <Field
            label="Status MFA"
            value={
              user.mfaEnabled ? (
                <Badge variant="success">Aktif</Badge>
              ) : (
                <Badge variant="warning">Belum aktif</Badge>
              )
            }
          />
        </CardContent>
      </Card>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle>Tindakan cepat</CardTitle>
          <p className="text-muted-foreground text-caption">
            Password &amp; MFA dikelola pada masing-masing halamannya. Semua perubahan tercatat pada
            audit log.
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={'/change-password' as Route}>
              <KeyRound className="h-4 w-4" aria-hidden />
              Ubah password
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={'/settings/security' as Route}>
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Kelola MFA &amp; sesi
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-overline uppercase">{label}</p>
      <div className={mono ? 'text-foreground text-body font-mono' : 'text-foreground text-body'}>
        {value}
      </div>
    </div>
  );
}
