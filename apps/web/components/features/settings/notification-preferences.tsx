'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationPreferenceRow, NotificationType } from '@workpulse/shared-types';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, notificationsApi } from '@/lib/api-client';

/**
 * Human-facing labels for each notification type. Keep the copy short —
 * this becomes a matrix and long labels look terrible on narrow screens.
 */
const TYPE_LABELS: Record<NotificationType, { title: string; hint: string }> = {
  LEAVE_SUBMITTED: {
    title: 'Cuti diajukan (tim Anda)',
    hint: 'Anda menerima notifikasi ketika bawahan mengajukan cuti.',
  },
  LEAVE_APPROVED_SUPERVISOR: {
    title: 'Cuti disetujui atasan',
    hint: 'Diberitahu setelah supervisor menyetujui cuti Anda.',
  },
  LEAVE_APPROVED_HR: {
    title: 'Cuti disetujui HR',
    hint: 'Diberitahu setelah HR menyetujui cuti Anda.',
  },
  LEAVE_REJECTED: {
    title: 'Cuti ditolak',
    hint: 'Diberitahu ketika pengajuan cuti Anda ditolak.',
  },
  LEAVE_CANCELLED: {
    title: 'Cuti dibatalkan',
    hint: 'Diberitahu ketika Anda / atasan membatalkan pengajuan cuti.',
  },
  OVERTIME_SUBMITTED: {
    title: 'Lembur diajukan (tim Anda)',
    hint: 'Anda menerima notifikasi ketika bawahan mengajukan lembur.',
  },
  OVERTIME_APPROVED: {
    title: 'Lembur disetujui',
    hint: 'Diberitahu setelah lembur Anda disetujui.',
  },
  OVERTIME_REJECTED: {
    title: 'Lembur ditolak',
    hint: 'Diberitahu ketika pengajuan lembur ditolak.',
  },
  OVERTIME_CANCELLED: {
    title: 'Lembur dibatalkan',
    hint: 'Diberitahu ketika pengajuan lembur dibatalkan.',
  },
  OVERTIME_COMPLETED: {
    title: 'Lembur selesai',
    hint: 'Diberitahu setelah scheduler menyelesaikan lembur (kehadiran terverifikasi).',
  },
  PASSWORD_RESET: {
    title: 'Konfirmasi reset password',
    hint: 'Notifikasi keamanan — tidak dapat dinonaktifkan.',
  },
  ATTENDANCE_ABSENT_MARKED: {
    title: 'Ditandai absen',
    hint: 'Diberitahu ketika sistem menandai Anda absen di hari kerja.',
  },
  ATTENDANCE_CORRECTION_SUBMITTED: {
    title: 'Koreksi absensi diajukan (tim Anda)',
    hint: 'Anda menerima notifikasi ketika bawahan mengajukan koreksi absensi.',
  },
  ATTENDANCE_CORRECTION_APPROVED: {
    title: 'Koreksi absensi disetujui',
    hint: 'Diberitahu setelah koreksi absensi Anda disetujui.',
  },
  ATTENDANCE_CORRECTION_REJECTED: {
    title: 'Koreksi absensi ditolak',
    hint: 'Diberitahu ketika koreksi absensi ditolak.',
  },
  DATA_ERASURE_REQUESTED: {
    title: 'Permintaan penghapusan data masuk',
    hint: 'Notifikasi ketika ada pengajuan hak untuk dilupakan (untuk HR/admin).',
  },
  DATA_ERASURE_APPROVED: {
    title: 'Penghapusan data disetujui',
    hint: 'Notifikasi ketika permintaan penghapusan data Anda disetujui.',
  },
  DATA_ERASURE_REJECTED: {
    title: 'Penghapusan data ditolak',
    hint: 'Notifikasi ketika permintaan penghapusan data Anda ditolak.',
  },
  DATA_ERASURE_EXECUTED: {
    title: 'Penghapusan data dieksekusi',
    hint: 'Notifikasi ke HR/admin setelah anonimisasi selesai berjalan.',
  },
  TIMESHEET_SUBMITTED: {
    title: 'Timesheet menunggu review',
    hint: 'Notifikasi ke supervisor saat karyawan submit timesheet.',
  },
  TIMESHEET_APPROVED_SUPERVISOR: {
    title: 'Timesheet disetujui supervisor',
    hint: 'Notifikasi ke Anda saat supervisor menyetujui timesheet.',
  },
  TIMESHEET_APPROVED_HR: {
    title: 'Timesheet disetujui HR',
    hint: 'Notifikasi final saat HR mengunci timesheet.',
  },
  TIMESHEET_REJECTED: {
    title: 'Timesheet ditolak',
    hint: 'Notifikasi ke Anda saat timesheet ditolak untuk revisi.',
  },
  TIMESHEET_REGENERATED: {
    title: 'Timesheet diperbarui',
    hint: 'Notifikasi saat data timesheet Anda otomatis diperbarui setelah koreksi kehadiran disetujui.',
  },
  TIMESHEET_SUBMIT_REMINDER: {
    title: 'Reminder submit timesheet',
    hint: 'Pengingat harian saat periode timesheet Anda sudah ditutup tapi belum di-submit.',
  },
  TIMESHEET_APPROVAL_REMINDER: {
    title: 'Reminder review timesheet',
    hint: 'Pengingat harian untuk supervisor/HR saat ada timesheet menunggu keputusan Anda.',
  },
  TIMESHEET_REOPENED: {
    title: 'Timesheet dibuka kembali',
    hint: 'HR membuka kembali timesheet Anda yang sudah APPROVED (mis. koreksi pasca-payroll). Sangat direkomendasikan tetap aktif.',
  },
  BREACH_DEADLINE_WARNING: {
    title: 'Reminder deadline breach 72 jam',
    hint: 'Notifikasi otomatis untuk DPO/HR ketika insiden pelanggaran data mendekati atau melewati batas 72 jam UU PDP.',
  },
  RETENTION_AUDIT_GAP_DETECTED: {
    title: 'Retention audit menemukan gap',
    hint: 'Notifikasi bulanan untuk DPO/HR ketika audit retention menemukan data yang seharusnya sudah dihapus tapi masih tersisa, atau worker retention gagal berjalan.',
  },
  VENDOR_REVIEW_DUE: {
    title: 'Review vendor / processor jatuh tempo',
    hint: 'Nudge untuk DPO/HR ketika review tahunan vendor / processor mendekati (T-30 hari) atau sudah melewati cutoff.',
  },
  VENDOR_CONTRACT_EXPIRING: {
    title: 'Kontrak vendor hampir habis',
    hint: 'Peringatan bahwa kontrak dengan vendor / processor akan berakhir dalam 60 hari (atau sudah kadaluarsa) sehingga negosiasi renewal dapat dimulai lebih awal.',
  },
  LOCATION_SHARE_REQUESTED: {
    title: 'Permintaan berbagi lokasi',
    hint: 'Diberitahu saat supervisor Anda meminta lokasi Anda selama shift aktif (ADR-0041). Sangat direkomendasikan tetap aktif — Anda perlu tahu setiap permintaan agar dapat menerima atau menolak.',
  },
  LOCATION_SHARE_RESPONDED: {
    title: 'Respon permintaan lokasi',
    hint: 'Notifikasi ke supervisor saat karyawan menjawab (menerima, menolak, atau hangus) permintaan lokasi.',
  },
  LOCATION_SHARE_VIEWED: {
    title: 'Lokasi Anda dilihat',
    hint: 'Diberitahu setiap kali supervisor atau HR membuka koordinat yang Anda bagikan — transparansi wajib per ADR-0041 dan tidak dapat dinonaktifkan.',
  },
  LOCATION_SHARING_CONSENT_CHANGED: {
    title: 'Perubahan persetujuan berbagi lokasi',
    hint: 'Konfirmasi ke Anda sendiri saat mengaktifkan / menonaktifkan persetujuan berbagi lokasi. Berperan sebagai bukti bahwa aksi tersebut memang dilakukan oleh Anda.',
  },
};

/** Group types into sections for readability. */
const SECTIONS: Array<{ id: string; label: string; types: NotificationType[] }> = [
  {
    id: 'leave',
    label: 'Cuti',
    types: [
      'LEAVE_SUBMITTED',
      'LEAVE_APPROVED_SUPERVISOR',
      'LEAVE_APPROVED_HR',
      'LEAVE_REJECTED',
      'LEAVE_CANCELLED',
    ],
  },
  {
    id: 'overtime',
    label: 'Lembur',
    types: [
      'OVERTIME_SUBMITTED',
      'OVERTIME_APPROVED',
      'OVERTIME_REJECTED',
      'OVERTIME_CANCELLED',
      'OVERTIME_COMPLETED',
    ],
  },
  {
    id: 'attendance',
    label: 'Absensi',
    types: [
      'ATTENDANCE_ABSENT_MARKED',
      'ATTENDANCE_CORRECTION_SUBMITTED',
      'ATTENDANCE_CORRECTION_APPROVED',
      'ATTENDANCE_CORRECTION_REJECTED',
    ],
  },
  {
    id: 'timesheet',
    label: 'Timesheet',
    types: [
      'TIMESHEET_SUBMITTED',
      'TIMESHEET_APPROVED_SUPERVISOR',
      'TIMESHEET_APPROVED_HR',
      'TIMESHEET_REJECTED',
      'TIMESHEET_REGENERATED',
    ],
  },
  {
    id: 'security',
    label: 'Keamanan',
    types: ['PASSWORD_RESET'],
  },
  {
    id: 'privacy',
    label: 'Privasi',
    types: [
      'DATA_ERASURE_REQUESTED',
      'DATA_ERASURE_APPROVED',
      'DATA_ERASURE_REJECTED',
      'DATA_ERASURE_EXECUTED',
      'RETENTION_AUDIT_GAP_DETECTED',
    ],
  },
  {
    id: 'compliance',
    label: 'Kepatuhan',
    types: ['BREACH_DEADLINE_WARNING', 'VENDOR_REVIEW_DUE', 'VENDOR_CONTRACT_EXPIRING'],
  },
  {
    id: 'location-sharing',
    label: 'Berbagi Lokasi',
    types: [
      'LOCATION_SHARE_REQUESTED',
      'LOCATION_SHARE_RESPONDED',
      'LOCATION_SHARE_VIEWED',
      'LOCATION_SHARING_CONSENT_CHANGED',
    ],
  },
];

interface DraftMap {
  [type: string]: { emailEnabled: boolean; inAppEnabled: boolean };
}

/**
 * Client-side notification preferences matrix. Keeps a local draft
 * that's separate from the server state until the user clicks "Simpan".
 * This makes "Batal" cheap (revert to last-saved) and avoids one PUT
 * per toggle click.
 */
export function NotificationPreferencesForm(): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => notificationsApi.listPreferences(),
  });

  const [draft, setDraft] = useState<DraftMap>({});
  const [status, setStatus] = useState<null | 'saved' | 'error'>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: DraftMap = {};
    for (const row of data) {
      next[row.type] = {
        emailEnabled: row.emailEnabled,
        inAppEnabled: row.inAppEnabled,
      };
    }
    setDraft(next);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    for (const row of data) {
      const d = draft[row.type];
      if (!d) continue;
      if (d.emailEnabled !== row.emailEnabled || d.inAppEnabled !== row.inAppEnabled) {
        return true;
      }
    }
    return false;
  }, [data, draft]);

  const save = useMutation({
    mutationFn: () => {
      if (!data) return Promise.resolve([]);
      const updates = data
        .filter((row) => !row.mandatory)
        .map((row) => ({
          type: row.type,
          emailEnabled: draft[row.type]?.emailEnabled ?? row.emailEnabled,
          inAppEnabled: draft[row.type]?.inAppEnabled ?? row.inAppEnabled,
        }));
      return notificationsApi.updatePreferences({ updates });
    },
    onSuccess: (fresh) => {
      setErrorMsg(null);
      setStatus('saved');
      // Server response is the authoritative fresh list — seed the cache
      // instead of firing another GET.
      qc.setQueryData(['notification-preferences'], fresh);
    },
    onError: (err) => {
      setStatus('error');
      if (err instanceof ApiError) setErrorMsg(err.message);
      else setErrorMsg('Gagal menyimpan preferensi.');
    },
  });

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Memuat preferensi…</p>;
  }
  if (isError || !data) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Gagal memuat preferensi: {error instanceof Error ? error.message : 'unknown error'}
      </p>
    );
  }

  const byType = new Map<NotificationType, NotificationPreferenceRow>(data.map((r) => [r.type, r]));

  const toggle = (type: NotificationType, channel: 'emailEnabled' | 'inAppEnabled'): void => {
    setStatus(null);
    setDraft((prev) => ({
      ...prev,
      [type]: {
        emailEnabled: prev[type]?.emailEnabled ?? true,
        inAppEnabled: prev[type]?.inAppEnabled ?? true,
        [channel]: !(prev[type]?.[channel] ?? true),
      },
    }));
  };

  const handleReset = (): void => {
    if (!data) return;
    const next: DraftMap = {};
    for (const row of data) {
      next[row.type] = {
        emailEnabled: row.emailEnabled,
        inAppEnabled: row.inAppEnabled,
      };
    }
    setDraft(next);
    setStatus(null);
    setErrorMsg(null);
  };

  return (
    <div className="space-y-6">
      <div className="bg-muted/40 text-muted-foreground rounded-lg border p-3 text-xs">
        Notifikasi wajib (mis. konfirmasi reset password) tidak dapat dinonaktifkan — keamanan
        mengharuskannya tetap terkirim.
      </div>

      {SECTIONS.map((section) => {
        const rows = section.types
          .map((t) => byType.get(t))
          .filter((r): r is NotificationPreferenceRow => Boolean(r));
        if (rows.length === 0) return null;
        return (
          <section
            key={section.id}
            className="overflow-hidden rounded-lg border"
            aria-labelledby={`prefs-${section.id}`}
          >
            <header className="bg-muted/50 border-b px-4 py-2">
              <h3 id={`prefs-${section.id}`} className="text-sm font-semibold">
                {section.label}
              </h3>
            </header>
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-[11px] uppercase tracking-widest">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Jenis</th>
                  <th className="w-24 px-2 py-2 text-center font-medium">In-app</th>
                  <th className="w-24 px-4 py-2 text-center font-medium">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((row) => {
                  const meta = TYPE_LABELS[row.type];
                  const d = draft[row.type] ?? row;
                  return (
                    <tr key={row.type} className="hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{meta.title}</span>
                          {row.mandatory && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-amber-900">
                              Wajib
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">{meta.hint}</p>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={d.inAppEnabled}
                            disabled={row.mandatory || save.isPending}
                            onChange={() => toggle(row.type, 'inAppEnabled')}
                            aria-label={`In-app ${meta.title}`}
                          />
                        </label>
                      </td>
                      <td className="px-4 py-2 text-center">
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={d.emailEnabled}
                            disabled={row.mandatory || save.isPending}
                            onChange={() => toggle(row.type, 'emailEnabled')}
                            aria-label={`Email ${meta.title}`}
                          />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}

      <div className="flex items-center justify-between gap-3">
        <div className="text-xs">
          {status === 'saved' && <span className="text-emerald-700">Preferensi tersimpan.</span>}
          {status === 'error' && errorMsg && (
            <span role="alert" className="text-destructive">
              {errorMsg}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="border-input hover:bg-muted rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
            onClick={handleReset}
            disabled={!dirty || save.isPending}
          >
            Batal
          </button>
          <button
            type="button"
            className="bg-foreground text-background rounded-md px-3 py-2 text-xs font-medium shadow disabled:opacity-50"
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
          >
            {save.isPending ? 'Menyimpan…' : 'Simpan preferensi'}
          </button>
        </div>
      </div>
    </div>
  );
}
