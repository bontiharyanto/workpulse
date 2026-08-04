'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  AttendanceReportRequest,
  Department,
  LeaveSummaryReportRequest,
  OvertimeReportRequest,
  OvertimeStatus,
  ReportFormat,
} from '@workpulse/shared-types';

import {
  ApiError,
  departmentsAdminApi,
  reportsApi,
  saveBlob,
} from '@/lib/api-client';

const ERROR_COPY: Record<string, string> = {
  REPORT_RANGE_INVALID: 'Rentang tanggal tidak valid.',
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function ReportPanel(): JSX.Element {
  const [errorText, setErrorText] = useState<string | null>(null);

  const departments = useQuery({
    queryKey: ['admin', 'departments'],
    queryFn: () => departmentsAdminApi.list() as Promise<Department[]>,
  });

  const handleError = (err: unknown): void => {
    if (err instanceof ApiError) {
      const raw = err.code;
      // Sizing error is encoded as `REPORT_RANGE_TOO_LARGE:xlsx:max=366:actual=…`
      if (raw.startsWith('REPORT_RANGE_TOO_LARGE')) {
        const parts = raw.split(':');
        const cap = parts[2]?.split('=')[1];
        const actual = parts[3]?.split('=')[1];
        setErrorText(
          `Rentang terlalu panjang (${actual} hari). Maksimum ${cap} hari untuk format ini.`,
        );
        return;
      }
      setErrorText(ERROR_COPY[raw] ?? err.message);
    } else if (err instanceof Error) {
      setErrorText(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Laporan</h2>
        <p className="text-xs text-muted-foreground">
          Ekspor data dalam format Excel atau PDF. Rate limit: 5 permintaan / menit.
        </p>
      </div>

      {errorText && (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {errorText}
        </p>
      )}

      <AttendanceReportForm
        departments={departments.data ?? []}
        onError={handleError}
        onClearError={() => setErrorText(null)}
      />

      <LeaveSummaryReportForm
        departments={departments.data ?? []}
        onError={handleError}
        onClearError={() => setErrorText(null)}
      />

      <OvertimeReportForm
        departments={departments.data ?? []}
        onError={handleError}
        onClearError={() => setErrorText(null)}
      />
    </div>
  );
}

// ==========================================================================
// Attendance
// ==========================================================================

function AttendanceReportForm({
  departments,
  onError,
  onClearError,
}: {
  departments: Department[];
  onError: (e: unknown) => void;
  onClearError: () => void;
}): JSX.Element {
  const [state, setState] = useState<{
    startDate: string;
    endDate: string;
    departmentId: string;
  }>({
    startDate: daysAgoISO(30),
    endDate: todayISO(),
    departmentId: '',
  });

  const mut = useMutation({
    mutationFn: (format: ReportFormat) => {
      const body: AttendanceReportRequest = {
        format,
        startDate: state.startDate,
        endDate: state.endDate,
        departmentId: state.departmentId || null,
      };
      return reportsApi.attendance(body);
    },
    onSuccess: (result) => {
      onClearError();
      saveBlob(result);
    },
    onError,
  });

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Kehadiran</h3>
        <p className="text-xs text-muted-foreground">
          Rincian clock-in / clock-out per hari, termasuk keterlambatan &amp; pulang cepat.
          Maks. 366 hari untuk Excel, 92 hari untuk PDF.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <FieldDate
          label="Dari"
          value={state.startDate}
          onChange={(v) => setState({ ...state, startDate: v })}
        />
        <FieldDate
          label="Sampai"
          value={state.endDate}
          onChange={(v) => setState({ ...state, endDate: v })}
        />
        <FieldDepartment
          value={state.departmentId}
          departments={departments}
          onChange={(v) => setState({ ...state, departmentId: v })}
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('xlsx')}
            className="flex-1 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'xlsx' ? 'Mengunduh...' : 'Excel'}
          </button>
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('pdf')}
            className="flex-1 rounded-md border border-foreground px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'pdf' ? 'Mengunduh...' : 'PDF'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ==========================================================================
// Leave Summary
// ==========================================================================

function LeaveSummaryReportForm({
  departments,
  onError,
  onClearError,
}: {
  departments: Department[];
  onError: (e: unknown) => void;
  onClearError: () => void;
}): JSX.Element {
  const currentYear = new Date().getUTCFullYear();
  const [state, setState] = useState<{ year: number; departmentId: string }>({
    year: currentYear,
    departmentId: '',
  });

  const mut = useMutation({
    mutationFn: (format: ReportFormat) => {
      const body: LeaveSummaryReportRequest = {
        format,
        year: state.year,
        departmentId: state.departmentId || null,
      };
      return reportsApi.leaveSummary(body);
    },
    onSuccess: (result) => {
      onClearError();
      saveBlob(result);
    },
    onError,
  });

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Ringkasan Saldo Cuti</h3>
        <p className="text-xs text-muted-foreground">
          Matriks karyawan × tipe cuti dengan kuota, terpakai, reserved, dan sisa untuk
          tahun terpilih.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-xs font-medium uppercase tracking-wider">Tahun</label>
          <input
            type="number"
            min={2000}
            max={2100}
            value={state.year}
            onChange={(e) => setState({ ...state, year: Number(e.target.value) })}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
          />
        </div>
        <FieldDepartment
          value={state.departmentId}
          departments={departments}
          onChange={(v) => setState({ ...state, departmentId: v })}
        />
        <div className="flex items-end gap-2 md:col-span-2">
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('xlsx')}
            className="flex-1 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'xlsx' ? 'Mengunduh...' : 'Excel'}
          </button>
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('pdf')}
            className="flex-1 rounded-md border border-foreground px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'pdf' ? 'Mengunduh...' : 'PDF'}
          </button>
        </div>
      </div>
    </section>
  );
}

// ==========================================================================
// Overtime Summary
// ==========================================================================

const OVERTIME_STATUS_OPTIONS: ReadonlyArray<{ id: OvertimeStatus; label: string }> = [
  { id: 'APPROVED', label: 'Disetujui' },
  { id: 'COMPLETED', label: 'Selesai' },
  { id: 'PENDING_APPROVAL', label: 'Menunggu' },
  { id: 'REJECTED', label: 'Ditolak' },
  { id: 'CANCELLED', label: 'Dibatalkan' },
];

function OvertimeReportForm({
  departments,
  onError,
  onClearError,
}: {
  departments: Department[];
  onError: (e: unknown) => void;
  onClearError: () => void;
}): JSX.Element {
  // Payroll-focused default — APPROVED + COMPLETED only. HR can toggle other
  // statuses in for audit exports.
  const [state, setState] = useState<{
    startDate: string;
    endDate: string;
    departmentId: string;
    statuses: OvertimeStatus[];
  }>({
    startDate: daysAgoISO(30),
    endDate: todayISO(),
    departmentId: '',
    statuses: ['APPROVED', 'COMPLETED'],
  });

  const mut = useMutation({
    mutationFn: (format: ReportFormat) => {
      const body: OvertimeReportRequest = {
        format,
        startDate: state.startDate,
        endDate: state.endDate,
        departmentId: state.departmentId || null,
        statuses: state.statuses.length > 0 ? state.statuses : null,
      };
      return reportsApi.overtimeSummary(body);
    },
    onSuccess: (result) => {
      onClearError();
      saveBlob(result);
    },
    onError,
  });

  const toggleStatus = (s: OvertimeStatus): void => {
    setState((prev) => ({
      ...prev,
      statuses: prev.statuses.includes(s)
        ? prev.statuses.filter((x) => x !== s)
        : [...prev.statuses, s],
    }));
  };

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Lembur</h3>
        <p className="text-xs text-muted-foreground">
          Rincian pengajuan lembur beserta tarif, multiplier, dan total pembayaran. Default
          hanya menampilkan pengajuan <span className="font-medium">Disetujui</span> dan{' '}
          <span className="font-medium">Selesai</span> untuk kebutuhan payroll — centang
          status lain untuk audit lengkap. Maks. 366 hari untuk Excel, 92 hari untuk PDF.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <FieldDate
          label="Dari"
          value={state.startDate}
          onChange={(v) => setState({ ...state, startDate: v })}
        />
        <FieldDate
          label="Sampai"
          value={state.endDate}
          onChange={(v) => setState({ ...state, endDate: v })}
        />
        <FieldDepartment
          value={state.departmentId}
          departments={departments}
          onChange={(v) => setState({ ...state, departmentId: v })}
        />
        <div className="flex items-end gap-2">
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('xlsx')}
            className="flex-1 rounded-md bg-foreground px-3 py-2 text-xs font-medium text-background disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'xlsx' ? 'Mengunduh...' : 'Excel'}
          </button>
          <button
            type="button"
            disabled={mut.isPending}
            onClick={() => mut.mutate('pdf')}
            className="flex-1 rounded-md border border-foreground px-3 py-2 text-xs font-medium disabled:opacity-50"
          >
            {mut.isPending && mut.variables === 'pdf' ? 'Mengunduh...' : 'PDF'}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        <label className="text-xs font-medium uppercase tracking-wider">Status</label>
        <div className="flex flex-wrap gap-2 text-xs">
          {OVERTIME_STATUS_OPTIONS.map((opt) => {
            const active = state.statuses.includes(opt.id);
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleStatus(opt.id)}
                className={
                  active
                    ? 'rounded-full border border-foreground bg-foreground px-2.5 py-0.5 text-background'
                    : 'rounded-full border border-input px-2.5 py-0.5 text-muted-foreground hover:bg-accent'
                }
                aria-pressed={active}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ==========================================================================
// Reused fields
// ==========================================================================

function FieldDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
      />
    </div>
  );
}

function FieldDepartment({
  value,
  departments,
  onChange,
}: {
  value: string;
  departments: Department[];
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium uppercase tracking-wider">Departemen</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">Semua departemen</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
    </div>
  );
}
