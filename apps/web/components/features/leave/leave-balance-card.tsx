'use client';

import { useQuery } from '@tanstack/react-query';

import { leaveApi } from '@/lib/api-client';

export function LeaveBalanceCard(): JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['leave', 'balance'],
    queryFn: () => leaveApi.balance(),
  });

  if (isLoading) {
    return (
      <div className="text-muted-foreground rounded-lg border p-4 text-sm">
        Memuat saldo cuti...
      </div>
    );
  }
  if (error) {
    return (
      <div className="border-destructive/40 bg-destructive/5 text-destructive rounded-lg border p-4 text-sm">
        Gagal memuat saldo.
      </div>
    );
  }
  if (!data || data.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border p-4 text-sm">
        Belum ada saldo cuti tahun ini. Submit permintaan pertama akan otomatis membuat saldo.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((b) => (
        <div key={b.leaveTypeId} className="rounded-lg border p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{b.leaveTypeName}</p>
            <span className="bg-muted rounded-full px-2 py-0.5 text-xs">{b.year}</span>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{b.remaining}</p>
          <p className="text-muted-foreground text-xs">
            hari tersisa dari {b.quota + b.carriedOver}
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Terpakai</dt>
              <dd className="font-medium tabular-nums">{b.used}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Reservasi</dt>
              <dd className="font-medium tabular-nums">{b.reserved}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Carry-over</dt>
              <dd className="font-medium tabular-nums">{b.carriedOver}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
