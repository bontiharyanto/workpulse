'use client';

/**
 * Admin-side awareness card that surfaces the exact set of users who
 * cannot clock in today because they lack an in-force `UserShiftAssignment`.
 *
 * The card is intentionally placed at the top of `/admin/shifts` — the
 * page where HR is most likely to act on the information. Clicking
 * "Assign now" preselects the user in the shift-assignment panel below
 * (via the `?userId=` search param) and scrolls the page to it, keeping
 * the whole flow inside a single route.
 *
 * Business scope note: SUPER_ADMIN users are excluded server-side because
 * they are cross-tenant actors that never clock in against a geofence.
 * Terminated / suspended employees are also excluded — see
 * `ShiftService.listUsersWithoutActiveShift` for the exact predicate.
 */

import { useQuery } from '@tanstack/react-query';
import type { UserRole, UserWithoutShift } from '@workpulse/shared-types';
import { AlertTriangle, CheckCircle2, UserCog } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, shiftsAdminApi } from '@/lib/api-client';

import { SHIFT_ASSIGNMENT_PANEL_ANCHOR } from './shift-assignment-panel';

const ROLE_LABEL: Record<UserRole, string> = {
  EMPLOYEE: 'Karyawan',
  SUPERVISOR: 'Supervisor',
  HR_MANAGER: 'HR Manager',
  SUPER_ADMIN: 'Super Admin',
};

interface Props {
  /**
   * Called when HR clicks "Assign now" for a specific user. Parent is
   * expected to sync the URL (`?userId=…`) and forward the value to
   * `ShiftAssignmentPanel` via its `initialUserId` prop.
   */
  onAssignUser: (userId: string) => void;
}

export function UsersWithoutShiftCard({ onAssignUser }: Props): JSX.Element {
  const query = useQuery({
    queryKey: ['admin', 'shifts', 'users-without-active-shift'],
    queryFn: () => shiftsAdminApi.listUsersWithoutActiveShift(),
    // Cheap enough to keep fresh: this is a tiny list that HR wants
    // to see reflect their assignment actions immediately. React Query
    // will refetch on window focus by default which is fine here.
  });

  if (query.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <UserCog className="text-muted-foreground h-4 w-4" />
            <CardTitle className="text-base">Karyawan tanpa shift aktif</CardTitle>
          </div>
          <CardDescription>Memeriksa siapa yang belum bisa clock-in hari ini…</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </CardContent>
      </Card>
    );
  }

  if (query.isError) {
    const code =
      query.error instanceof ApiError ? query.error.code : (query.error as Error)?.message;
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-destructive h-4 w-4" />
            <CardTitle className="text-destructive text-base">
              Gagal memuat karyawan tanpa shift
            </CardTitle>
          </div>
          <CardDescription>
            {code ?? 'Terjadi kesalahan tidak terduga. Coba muat ulang halaman.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => query.refetch()}>
            Coba lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rows: UserWithoutShift[] = query.data ?? [];

  if (rows.length === 0) {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="text-success h-4 w-4" />
            <CardTitle className="text-success-foreground text-base">
              Semua karyawan sudah punya shift aktif
            </CardTitle>
          </div>
          <CardDescription>
            Tidak ada karyawan yang saat ini terblokir <code>SHIFT_NOT_FOUND</code> saat clock-in.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-warning/40 bg-warning/5">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-warning h-4 w-4" />
            <CardTitle className="text-base">Karyawan tanpa shift aktif</CardTitle>
            <Badge variant="warning">{rows.length}</Badge>
          </div>
        </div>
        <CardDescription>
          Mereka tidak dapat melakukan clock-in sampai HR mengassign shift. Klik{' '}
          <span className="font-medium">Assign sekarang</span> untuk preselect karyawan di panel
          Assignment di bawah.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="border-warning/30 overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-warning/10 text-muted-foreground text-xs uppercase tracking-wider">
              <tr>
                <th className="px-3 py-2 text-left">Nama</th>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Departemen</th>
                <th className="px-3 py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((u) => (
                <tr key={u.id}>
                  <td className="px-3 py-2 font-medium">{u.fullName}</td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">{u.email}</td>
                  <td className="px-3 py-2">
                    <Badge variant="secondary">{ROLE_LABEL[u.role]}</Badge>
                  </td>
                  <td className="text-muted-foreground px-3 py-2 text-xs">
                    {u.departmentName ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onAssignUser(u.id);
                        // Small timeout so React commits the state update
                        // (which may enable the assignment panel) before
                        // scrollIntoView measures its layout.
                        setTimeout(() => {
                          document
                            .getElementById(SHIFT_ASSIGNMENT_PANEL_ANCHOR)
                            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }, 0);
                      }}
                    >
                      Assign sekarang
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
