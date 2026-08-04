'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeamMemberDailyRow, TeamMemberSummaryRow } from '@workpulse/shared-types';
import { useMemo, useState } from 'react';

import { useAuth } from '@/components/providers/auth-provider';
import { attendanceApi, companyAdminApi } from '@/lib/api-client';

/**
 * Team attendance panel for supervisors / HR. Renders one of two tabs:
 *   - "Hari ini" (default) — roster + today's clock-in status.
 *   - "Rekap" — per-member summary over a rolling range (7 / 14 / 30 days).
 *
 * Access control is enforced server-side; on the client we just make sure
 * the entry point isn't offered to employees.
 */

type Tab = 'today' | 'summary';
type RangePreset = '7' | '14' | '30';

export function TeamAttendance(): JSX.Element | null {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('today');
  const [range, setRange] = useState<RangePreset>('7');
  const [date, setDate] = useState<string>(() => toIsoDate(new Date()));

  const canView =
    !!user &&
    (user.role === 'SUPERVISOR' || user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  // Manual absence override is HR-only (server enforces; UI hides for others).
  const canOverrideAbsence = !!user && (user.role === 'HR_MANAGER' || user.role === 'SUPER_ADMIN');

  if (!canView) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="bg-background flex gap-1 rounded-md border p-0.5 text-xs">
          <TabButton active={tab === 'today'} onClick={() => setTab('today')}>
            Hari ini
          </TabButton>
          <TabButton active={tab === 'summary'} onClick={() => setTab('summary')}>
            Rekap
          </TabButton>
        </div>

        {tab === 'today' ? (
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            Tanggal
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={toIsoDate(new Date())}
              className="border-input bg-background rounded-md border px-2 py-1 text-xs"
            />
          </label>
        ) : (
          <div className="bg-background flex gap-1 rounded-md border p-0.5 text-xs">
            {(['7', '14', '30'] as RangePreset[]).map((p) => (
              <TabButton key={p} active={range === p} onClick={() => setRange(p)}>
                {p}h
              </TabButton>
            ))}
          </div>
        )}
      </div>

      {tab === 'today' ? (
        <TodayTable date={date} canOverrideAbsence={canOverrideAbsence} />
      ) : (
        <SummaryTable range={range} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

function TodayTable({
  date,
  canOverrideAbsence,
}: {
  date: string;
  canOverrideAbsence: boolean;
}): JSX.Element {
  const list = useQuery({
    queryKey: ['attendance', 'team', 'today', date],
    queryFn: () => attendanceApi.teamToday({ date }),
    refetchInterval: 60_000, // roster refreshes as people clock in
    staleTime: 30_000,
  });

  // HR + Super Admin get the company config so we can gate the mark/delete
  // buttons against the payroll cutoff. Fetched lazily (canOverrideAbsence
  // is required by the /admin/company RBAC anyway).
  const config = useQuery({
    queryKey: ['company', 'config'],
    queryFn: () => companyAdminApi.get(),
    enabled: canOverrideAbsence,
    staleTime: 5 * 60_000, // 5 min — cutoff changes are rare
  });
  const payrollLockedUntil = config.data?.payrollLockedUntil ?? null;
  const dateIsLocked = !!payrollLockedUntil && date <= payrollLockedUntil;

  // Track which row is expanded for the "mark absent" reason input.
  const [openMarkFor, setOpenMarkFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const qc = useQueryClient();

  const markMutation = useMutation({
    mutationFn: attendanceApi.markAbsent,
    onSuccess: async () => {
      setOpenMarkFor(null);
      setReason('');
      setErrorMsg(null);
      await qc.invalidateQueries({ queryKey: ['attendance', 'team', 'today', date] });
      await qc.invalidateQueries({ queryKey: ['attendance', 'dashboard'] });
    },
    onError: (err: unknown) => {
      setErrorMsg(errorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => attendanceApi.deleteAbsence(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['attendance', 'team', 'today', date] });
      await qc.invalidateQueries({ queryKey: ['attendance', 'dashboard'] });
    },
  });

  const colCount = canOverrideAbsence ? 7 : 6;

  return (
    <div className="space-y-2">
      {canOverrideAbsence && dateIsLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <span className="font-medium">Periode terkunci payroll</span> — {date} berada di dalam
          cutoff <code className="rounded bg-white/70 px-1">{payrollLockedUntil}</code>. HR tidak
          dapat menandai / mencabut absen pada tanggal ini; hubungi Super Admin bila diperlukan
          koreksi.
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Departemen</th>
              <th className="px-3 py-2">Clock-in</th>
              <th className="px-3 py-2">Clock-out</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Telat</th>
              {canOverrideAbsence ? <th className="px-3 py-2 text-right">Aksi</th> : null}
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr>
                <td
                  colSpan={colCount}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  Memuat...
                </td>
              </tr>
            ) : list.data && list.data.length > 0 ? (
              list.data.map((r) => (
                <TodayRow
                  key={r.userId}
                  row={r}
                  date={date}
                  canOverride={canOverrideAbsence}
                  dateIsLocked={dateIsLocked}
                  isMarkOpen={openMarkFor === r.userId}
                  reason={reason}
                  errorMsg={openMarkFor === r.userId ? errorMsg : null}
                  onOpenMark={() => {
                    setOpenMarkFor(r.userId);
                    setReason('');
                    setErrorMsg(null);
                  }}
                  onCancelMark={() => {
                    setOpenMarkFor(null);
                    setReason('');
                    setErrorMsg(null);
                  }}
                  onReasonChange={setReason}
                  onSubmitMark={() => {
                    markMutation.mutate({
                      userId: r.userId,
                      workDate: date,
                      reason: reason.trim() ? reason.trim() : undefined,
                    });
                  }}
                  isSubmitting={markMutation.isPending && openMarkFor === r.userId}
                  onDeleteAbsence={(id: string) => {
                    if (
                      typeof window !== 'undefined' &&
                      !window.confirm(
                        `Yakin membatalkan status absen untuk ${r.fullName} pada ${date}?`,
                      )
                    ) {
                      return;
                    }
                    deleteMutation.mutate(id);
                  }}
                  isDeleting={
                    deleteMutation.isPending && deleteMutation.variables === r.absenceRecordId
                  }
                />
              ))
            ) : (
              <tr>
                <td
                  colSpan={colCount}
                  className="text-muted-foreground px-3 py-6 text-center text-sm"
                >
                  Tidak ada anggota tim dalam scope Anda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface TodayRowProps {
  row: TeamMemberDailyRow;
  date: string;
  canOverride: boolean;
  /** Whether the current date is inside the tenant's payroll lock. */
  dateIsLocked: boolean;
  isMarkOpen: boolean;
  reason: string;
  errorMsg: string | null;
  onOpenMark: () => void;
  onCancelMark: () => void;
  onReasonChange: (v: string) => void;
  onSubmitMark: () => void;
  isSubmitting: boolean;
  onDeleteAbsence: (id: string) => void;
  isDeleting: boolean;
}

function TodayRow(props: TodayRowProps): JSX.Element {
  const {
    row,
    canOverride,
    dateIsLocked,
    isMarkOpen,
    reason,
    errorMsg,
    onOpenMark,
    onCancelMark,
    onReasonChange,
    onSubmitMark,
    isSubmitting,
    onDeleteAbsence,
    isDeleting,
  } = props;

  const colCount = canOverride ? 7 : 6;

  return (
    <>
      <tr className="border-t">
        <td className="px-3 py-2">
          <div className="font-medium">{row.fullName}</div>
          <div className="text-muted-foreground text-[11px]">{row.email}</div>
        </td>
        <td className="text-muted-foreground px-3 py-2 text-xs">{row.departmentName ?? '—'}</td>
        <td className="px-3 py-2 tabular-nums">
          {row.clockInAt ? formatTime(row.clockInAt) : dash()}
        </td>
        <td className="px-3 py-2 tabular-nums">
          {row.clockOutAt ? formatTime(row.clockOutAt) : dash()}
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-col items-start gap-1">
            <TeamStatusPill status={row.status} />
            {row.status === 'ABSENT' && row.absenceSource ? (
              <AbsenceSourcePill source={row.absenceSource} />
            ) : null}
          </div>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">
          {row.lateMinutes > 0 ? (
            <span className="text-destructive">{row.lateMinutes}m</span>
          ) : (
            dash()
          )}
        </td>
        {canOverride ? (
          <td className="px-3 py-2 text-right">
            {row.status === 'NOT_CLOCKED_IN' && !isMarkOpen ? (
              <button
                type="button"
                onClick={onOpenMark}
                disabled={dateIsLocked}
                title={dateIsLocked ? 'Periode terkunci payroll' : undefined}
                className="text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                Absenkan
              </button>
            ) : null}
            {row.status === 'ABSENT' && row.absenceRecordId ? (
              <button
                type="button"
                onClick={() => onDeleteAbsence(row.absenceRecordId as string)}
                disabled={isDeleting || dateIsLocked}
                title={dateIsLocked ? 'Periode terkunci payroll' : undefined}
                className="text-muted-foreground hover:bg-muted rounded-md border px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isDeleting ? 'Menghapus...' : 'Batalkan'}
              </button>
            ) : null}
          </td>
        ) : null}
      </tr>
      {isMarkOpen ? (
        <tr className="bg-muted/20 border-t">
          <td colSpan={colCount} className="px-3 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                onSubmitMark();
              }}
              className="flex flex-wrap items-end gap-2"
            >
              <label className="text-muted-foreground flex flex-1 flex-col text-xs">
                Alasan (opsional, maks. 500 karakter)
                <input
                  autoFocus
                  type="text"
                  value={reason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  maxLength={500}
                  placeholder={`Contoh: ${row.fullName} tidak masuk tanpa keterangan.`}
                  className="border-input bg-background mt-1 rounded-md border px-2 py-1 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="bg-destructive text-destructive-foreground rounded-md px-3 py-1 text-xs font-medium disabled:opacity-50"
                >
                  {isSubmitting ? 'Menyimpan...' : 'Konfirmasi absen'}
                </button>
                <button
                  type="button"
                  onClick={onCancelMark}
                  className="text-muted-foreground rounded-md border px-3 py-1 text-xs"
                >
                  Batal
                </button>
              </div>
              {errorMsg ? <p className="text-destructive w-full text-xs">{errorMsg}</p> : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function AbsenceSourcePill({ source }: { source: 'AUTO_SCHEDULER' | 'MANUAL_HR' }): JSX.Element {
  const label = source === 'AUTO_SCHEDULER' ? 'Otomatis' : 'HR';
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
      {label}
    </span>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // Common domain codes from the API; keep the raw code so QA can grep it,
    // but wrap it in a human-readable sentence.
    if (err.message === 'CLOCKED_IN') {
      return 'Karyawan sudah melakukan clock-in pada tanggal ini.';
    }
    if (err.message === 'ALREADY_MARKED') {
      return 'Karyawan sudah tercatat absen pada tanggal ini.';
    }
    if (err.message === 'DATE_IN_FUTURE') {
      return 'Tanggal tidak boleh di masa depan.';
    }
    if (err.message === 'NOT_HIRED_YET') {
      return 'Karyawan belum aktif pada tanggal tersebut.';
    }
    if (err.message === 'PAYROLL_LOCKED') {
      return 'Tanggal ini berada dalam periode payroll yang sudah terkunci. Hanya Super Admin yang dapat memodifikasi.';
    }
    return err.message;
  }
  return 'Terjadi kesalahan. Coba lagi.';
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryTable({ range }: { range: RangePreset }): JSX.Element {
  const days = Number(range);
  const { from, to } = useMemo(() => {
    const t = new Date();
    const f = new Date(t);
    f.setUTCDate(f.getUTCDate() - (days - 1));
    return { from: toIsoDate(f), to: toIsoDate(t) };
  }, [days]);

  const query = useQuery({
    queryKey: ['attendance', 'team', 'summary', from, to],
    queryFn: () => attendanceApi.teamSummary({ from, to }),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs">
        Rentang: {from} → {to} · {days} hari
      </p>
      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground text-left text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-2">Nama</th>
              <th className="px-3 py-2">Departemen</th>
              <th className="px-3 py-2 text-right">Hadir</th>
              <th className="px-3 py-2 text-right">Tepat waktu</th>
              <th className="px-3 py-2 text-right">Terlambat</th>
              <th className="px-3 py-2 text-right">Absen</th>
              <th className="px-3 py-2 text-right">Menit telat</th>
              <th className="px-3 py-2 text-right">Total jam</th>
              <th className="px-3 py-2 text-right">On-time %</th>
            </tr>
          </thead>
          <tbody>
            {query.isLoading ? (
              <tr>
                <td colSpan={9} className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Memuat...
                </td>
              </tr>
            ) : query.data && query.data.rows.length > 0 ? (
              query.data.rows.map((r) => <SummaryRow key={r.userId} row={r} />)
            ) : (
              <tr>
                <td colSpan={9} className="text-muted-foreground px-3 py-6 text-center text-sm">
                  Tidak ada data pada rentang ini.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SummaryRow({ row }: { row: TeamMemberSummaryRow }): JSX.Element {
  const rate = row.onTimeRatePercent;
  const rateClass =
    rate === null
      ? 'text-muted-foreground'
      : rate >= 90
        ? 'text-emerald-600'
        : rate >= 75
          ? 'text-amber-700'
          : 'text-destructive';

  return (
    <tr className="border-t">
      <td className="px-3 py-2">
        <div className="font-medium">{row.fullName}</div>
        <div className="text-muted-foreground text-[11px]">{row.email}</div>
      </td>
      <td className="text-muted-foreground px-3 py-2 text-xs">{row.departmentName ?? '—'}</td>
      <td className="px-3 py-2 text-right tabular-nums">{row.presentDays}</td>
      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{row.onTimeDays}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.lateDays > 0 ? <span className="text-destructive">{row.lateDays}</span> : dash()}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.absentDays > 0 ? <span className="text-destructive">{row.absentDays}</span> : dash()}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">
        {row.totalLateMinutes > 0 ? row.totalLateMinutes : dash()}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.totalHoursWorked.toFixed(1)}</td>
      <td className={`px-3 py-2 text-right font-medium tabular-nums ${rateClass}`}>
        {rate === null ? '—' : `${rate.toFixed(1)}%`}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-2.5 py-1 ${
        active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function TeamStatusPill({ status }: { status: string }): JSX.Element {
  const styleFor = (): { label: string; className: string } => {
    switch (status) {
      case 'ON_TIME':
        return { label: 'Tepat waktu', className: 'bg-emerald-100 text-emerald-800' };
      case 'LATE':
        return { label: 'Terlambat', className: 'bg-destructive/10 text-destructive' };
      case 'EARLY_LEAVE':
        return { label: 'Pulang cepat', className: 'bg-amber-100 text-amber-800' };
      case 'ON_LEAVE':
        return { label: 'Cuti', className: 'bg-sky-100 text-sky-800' };
      case 'ABSENT':
        return { label: 'Absen', className: 'bg-muted text-muted-foreground' };
      case 'NOT_CLOCKED_IN':
        return { label: 'Belum clock-in', className: 'bg-slate-200 text-slate-700' };
      default:
        return { label: status, className: 'bg-muted text-muted-foreground' };
    }
  };
  const { label, className } = styleFor();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function dash(): JSX.Element {
  return <span className="text-muted-foreground">—</span>;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
