/**
 * Content templates for every notification type. Kept **pure**: given a
 * typed payload, return `{ title, body, data }`. No DB access, no clock, no
 * side effects — so tests can lock the strings down deterministically and
 * translations (future work) can be swapped by replacing this module.
 *
 * Convention:
 *   - `title` is short (<80 chars) — shows in bell dropdown and email subject.
 *   - `body` is one or two sentences — shows expanded in dropdown and email body.
 *   - `data` is a flat JSON object with references (IDs) the frontend uses
 *     for deep-linking. Never include free-form user text here that could
 *     be spoofed to look like a system message.
 *
 * All strings are Indonesian — Workpulse doesn't ship i18n yet.
 */

import type { NotificationType } from '@workpulse/shared-types';

export interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------------

export interface LeaveEventInput {
  leaveRequestId: string;
  requesterName: string;
  leaveTypeName: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;
  days: number;
  decidedByName?: string;
  note?: string | null;
}

export function leaveSubmitted(input: LeaveEventInput): NotificationContent {
  return {
    type: 'LEAVE_SUBMITTED',
    title: `Pengajuan cuti dari ${input.requesterName}`,
    body: `${input.requesterName} mengajukan ${input.leaveTypeName} sebanyak ${input.days} hari (${input.startDate} → ${input.endDate}). Menunggu keputusan Anda.`,
    data: {
      leaveRequestId: input.leaveRequestId,
      href: `/leave/approvals`,
    },
  };
}

export function leaveApprovedBySupervisor(input: LeaveEventInput): NotificationContent {
  return {
    type: 'LEAVE_APPROVED_SUPERVISOR',
    title: `Cuti disetujui supervisor — menunggu HR`,
    body: `Supervisor Anda menyetujui pengajuan ${input.leaveTypeName} ${input.days} hari (${input.startDate} → ${input.endDate}). Pengajuan berlanjut ke HR.`,
    data: {
      leaveRequestId: input.leaveRequestId,
      href: `/leave`,
    },
  };
}

export function leaveApprovedByHr(input: LeaveEventInput): NotificationContent {
  return {
    type: 'LEAVE_APPROVED_HR',
    title: `Cuti disetujui HR`,
    body: `Pengajuan ${input.leaveTypeName} ${input.days} hari (${input.startDate} → ${input.endDate}) telah disetujui secara final. Selamat berlibur!`,
    data: {
      leaveRequestId: input.leaveRequestId,
      href: `/leave`,
    },
  };
}

export function leaveRejected(input: LeaveEventInput): NotificationContent {
  const noteSuffix = input.note ? ` Catatan: "${truncate(input.note, 160)}".` : '';
  return {
    type: 'LEAVE_REJECTED',
    title: `Cuti ditolak`,
    body: `Pengajuan ${input.leaveTypeName} ${input.days} hari (${input.startDate} → ${input.endDate}) ditolak oleh ${input.decidedByName ?? 'atasan'}.${noteSuffix}`,
    data: {
      leaveRequestId: input.leaveRequestId,
      href: `/leave`,
    },
  };
}

// ---------------------------------------------------------------------------
// Overtime
// ---------------------------------------------------------------------------

export interface OvertimeEventInput {
  overtimeRequestId: string;
  requesterName: string;
  workDate: string; // YYYY-MM-DD
  hours: number;
  decidedByName?: string;
  note?: string | null;
}

export function overtimeSubmitted(input: OvertimeEventInput): NotificationContent {
  return {
    type: 'OVERTIME_SUBMITTED',
    title: `Pengajuan lembur dari ${input.requesterName}`,
    body: `${input.requesterName} mengajukan lembur ${input.hours} jam pada ${input.workDate}. Menunggu keputusan Anda.`,
    data: {
      overtimeRequestId: input.overtimeRequestId,
      href: `/overtime/approvals`,
    },
  };
}

export function overtimeApproved(input: OvertimeEventInput): NotificationContent {
  return {
    type: 'OVERTIME_APPROVED',
    title: `Lembur disetujui`,
    body: `Pengajuan lembur ${input.hours} jam pada ${input.workDate} telah disetujui${input.decidedByName ? ` oleh ${input.decidedByName}` : ''}.`,
    data: {
      overtimeRequestId: input.overtimeRequestId,
      href: `/overtime`,
    },
  };
}

export function overtimeRejected(input: OvertimeEventInput): NotificationContent {
  const noteSuffix = input.note ? ` Catatan: "${truncate(input.note, 160)}".` : '';
  return {
    type: 'OVERTIME_REJECTED',
    title: `Lembur ditolak`,
    body: `Pengajuan lembur ${input.hours} jam pada ${input.workDate} ditolak oleh ${input.decidedByName ?? 'atasan'}.${noteSuffix}`,
    data: {
      overtimeRequestId: input.overtimeRequestId,
      href: `/overtime`,
    },
  };
}

export function overtimeCompleted(input: OvertimeEventInput): NotificationContent {
  return {
    type: 'OVERTIME_COMPLETED',
    title: `Lembur diselesaikan`,
    body: `Lembur ${input.hours} jam pada ${input.workDate} telah diverifikasi kehadirannya dan siap dibayar.`,
    data: {
      overtimeRequestId: input.overtimeRequestId,
      href: `/overtime`,
    },
  };
}

// ---------------------------------------------------------------------------
// Password recovery
// ---------------------------------------------------------------------------

export interface PasswordResetSucceededInput {
  ipAddress?: string | null;
  userAgent?: string | null;
}

// ---------------------------------------------------------------------------
// Attendance — auto-absent classification
// ---------------------------------------------------------------------------

export interface AbsentMarkedInput {
  workDate: string; // ISO YYYY-MM-DD
  /** The person whose absence is being reported. */
  employeeName: string;
  /** True when the notification recipient is the supervisor, not the employee. */
  forSupervisor: boolean;
}

/**
 * Emitted when the auto-scheduler classifies a working day as ABSENT.
 * Sent to (a) the employee, and (b) their direct supervisor if any.
 *
 * Deliberately soft-worded: the classification may be wrong if the user
 * was on unrecorded leave, sick, or in a legitimate coverage gap. The
 * body invites disputes via HR rather than treating the record as
 * punitive-by-default.
 */
export function attendanceAbsentMarked(input: AbsentMarkedInput): NotificationContent {
  if (input.forSupervisor) {
    return {
      type: 'ATTENDANCE_ABSENT_MARKED',
      title: `Absen: ${input.employeeName}`,
      body: `${input.employeeName} tercatat tidak hadir pada ${input.workDate}. Silakan koordinasikan dengan yang bersangkutan atau HR jika ada koreksi.`,
      data: {
        workDate: input.workDate,
        href: `/attendance/team?date=${input.workDate}`,
      },
    };
  }
  return {
    type: 'ATTENDANCE_ABSENT_MARKED',
    title: 'Anda tercatat tidak hadir',
    body: `Sistem mencatat Anda tidak hadir pada ${input.workDate}. Jika ini keliru (misalnya sakit, izin darurat, atau kendala teknis), segera hubungi HR untuk koreksi.`,
    data: {
      workDate: input.workDate,
      href: `/attendance/history`,
    },
  };
}

/**
 * Post-reset confirmation notification. Deliberately does NOT include
 * the reset link (link is one-shot and already consumed). Purpose is
 * defence-in-depth: if an attacker succeeded in resetting the password,
 * the real user will see this in their bell / inbox and can escalate to
 * HR. Includes IP + user-agent hints for forensics.
 */
export function passwordResetSucceeded(
  input: PasswordResetSucceededInput,
): NotificationContent {
  const details: string[] = [];
  if (input.ipAddress) details.push(`IP ${input.ipAddress}`);
  if (input.userAgent) details.push(truncate(input.userAgent, 100));
  const detailSuffix = details.length > 0 ? ` (${details.join(' · ')})` : '';
  return {
    type: 'PASSWORD_RESET',
    title: 'Password Anda telah diubah',
    body:
      'Password akun Workpulse Anda baru saja direset. Jika bukan Anda yang melakukan ini, ' +
      `segera hubungi HR untuk mengamankan akun Anda${detailSuffix}.`,
    data: {
      // No href — post-reset confirmation is informational only.
      requiresAction: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Attendance corrections
// ---------------------------------------------------------------------------

export interface AttendanceCorrectionEventInput {
  correctionId: string;
  requesterName: string;
  workDate: string; // YYYY-MM-DD
  /** Human-readable summary of requested times — e.g. "in 09:00, out 18:00". */
  requestedSummary: string;
  decidedByName?: string;
  note?: string | null;
}

export function attendanceCorrectionSubmitted(
  input: AttendanceCorrectionEventInput,
): NotificationContent {
  return {
    type: 'ATTENDANCE_CORRECTION_SUBMITTED',
    title: `Koreksi absensi dari ${input.requesterName}`,
    body: `${input.requesterName} mengajukan koreksi presensi ${input.workDate} (${input.requestedSummary}). Menunggu keputusan Anda.`,
    data: {
      correctionId: input.correctionId,
      href: '/attendance/corrections/approvals',
    },
  };
}

export function attendanceCorrectionApproved(
  input: AttendanceCorrectionEventInput,
): NotificationContent {
  const by = input.decidedByName ? ` oleh ${input.decidedByName}` : '';
  return {
    type: 'ATTENDANCE_CORRECTION_APPROVED',
    title: `Koreksi absensi disetujui${by}`,
    body: `Koreksi presensi ${input.workDate} (${input.requestedSummary}) telah disetujui${by}.`,
    data: {
      correctionId: input.correctionId,
      href: '/attendance/corrections',
    },
  };
}

export function attendanceCorrectionRejected(
  input: AttendanceCorrectionEventInput,
): NotificationContent {
  const by = input.decidedByName ? ` oleh ${input.decidedByName}` : '';
  const noteSuffix = input.note
    ? ` Catatan: "${truncate(input.note, 160)}".`
    : '';
  return {
    type: 'ATTENDANCE_CORRECTION_REJECTED',
    title: `Koreksi absensi ditolak${by}`,
    body: `Koreksi presensi ${input.workDate} (${input.requestedSummary}) ditolak${by}.${noteSuffix}`,
    data: {
      correctionId: input.correctionId,
      href: '/attendance/corrections',
    },
  };
}

// ---------------------------------------------------------------------------
// Data erasure (Fase 31b)
// ---------------------------------------------------------------------------

export interface DataErasureEventInput {
  requestId: string;
  requesterName: string;
  /** Only for the APPROVED template — human-readable execution time. */
  scheduledFor?: string;
  /** For APPROVED / REJECTED — the deciding HR / admin. */
  decidedByName?: string;
  /** For REJECTED — free-form decision note. */
  note?: string | null;
}

export function dataErasureRequested(
  input: DataErasureEventInput,
): NotificationContent {
  return {
    type: 'DATA_ERASURE_REQUESTED',
    title: `Permintaan penghapusan data dari ${input.requesterName}`,
    body: `${input.requesterName} mengajukan penghapusan data pribadi. Tinjau permintaan ini di halaman admin privasi.`,
    data: {
      erasureRequestId: input.requestId,
      href: '/admin/privacy/erasure-requests',
    },
  };
}

export function dataErasureApproved(
  input: DataErasureEventInput,
): NotificationContent {
  const by = input.decidedByName ? ` oleh ${input.decidedByName}` : '';
  const when = input.scheduledFor
    ? ` Eksekusi dijadwalkan pada ${input.scheduledFor}`
    : '';
  return {
    type: 'DATA_ERASURE_APPROVED',
    title: `Permintaan penghapusan data disetujui${by}`,
    body: `Permintaan penghapusan data Anda telah disetujui${by}.${when}. Anda dapat membatalkan sebelum jadwal tersebut di /settings/privacy.`,
    data: {
      erasureRequestId: input.requestId,
      href: '/settings/privacy',
    },
  };
}

export function dataErasureRejected(
  input: DataErasureEventInput,
): NotificationContent {
  const by = input.decidedByName ? ` oleh ${input.decidedByName}` : '';
  const noteSuffix = input.note
    ? ` Catatan: "${truncate(input.note, 160)}".`
    : '';
  return {
    type: 'DATA_ERASURE_REJECTED',
    title: `Permintaan penghapusan data ditolak${by}`,
    body: `Permintaan penghapusan data Anda ditolak${by}.${noteSuffix}`,
    data: {
      erasureRequestId: input.requestId,
      href: '/settings/privacy',
    },
  };
}

export function dataErasureExecuted(
  input: DataErasureEventInput,
): NotificationContent {
  return {
    type: 'DATA_ERASURE_EXECUTED',
    title: `Data user ${input.requesterName} telah dianonimkan`,
    body: `Eksekusi penghapusan data untuk ${input.requesterName} selesai. Record bisnis (attendance, leave, overtime, audit) tetap disimpan sesuai kewajiban retensi.`,
    data: {
      erasureRequestId: input.requestId,
      href: '/admin/privacy/erasure-requests',
    },
  };
}

// ---------------------------------------------------------------------------
// Timesheet (Fase 32b)
// ---------------------------------------------------------------------------

export interface TimesheetEventInput {
  timesheetId: string;
  requesterName: string;
  periodLabel: string;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  decidedByName?: string;
  note?: string | null;
}

export function timesheetSubmitted(
  input: TimesheetEventInput,
): NotificationContent {
  return {
    type: 'TIMESHEET_SUBMITTED',
    title: `Timesheet dari ${input.requesterName} menunggu review`,
    body: `${input.requesterName} mengirim timesheet ${input.periodLabel} (${input.periodStart} → ${input.periodEnd}) untuk disetujui.`,
    data: {
      timesheetId: input.timesheetId,
      href: '/admin/timesheet',
    },
  };
}

export function timesheetApprovedBySupervisor(
  input: TimesheetEventInput,
): NotificationContent {
  return {
    type: 'TIMESHEET_APPROVED_SUPERVISOR',
    title: `Timesheet disetujui supervisor — menunggu HR`,
    body: `Supervisor Anda menyetujui timesheet ${input.periodLabel}. Menunggu keputusan final HR.`,
    data: {
      timesheetId: input.timesheetId,
      href: '/me/timesheet',
    },
  };
}

export function timesheetApprovedByHr(
  input: TimesheetEventInput,
): NotificationContent {
  return {
    type: 'TIMESHEET_APPROVED_HR',
    title: `Timesheet ${input.periodLabel} disetujui HR`,
    body: `Timesheet Anda untuk ${input.periodLabel} (${input.periodStart} → ${input.periodEnd}) telah disetujui secara final oleh HR dan siap masuk ke proses payroll.`,
    data: {
      timesheetId: input.timesheetId,
      href: '/me/timesheet',
    },
  };
}

export function timesheetRejected(
  input: TimesheetEventInput,
): NotificationContent {
  const by = input.decidedByName ? ` oleh ${input.decidedByName}` : '';
  const noteSuffix = input.note
    ? ` Catatan: "${truncate(input.note, 160)}".`
    : '';
  return {
    type: 'TIMESHEET_REJECTED',
    title: `Timesheet ${input.periodLabel} ditolak${by}`,
    body: `Timesheet Anda ditolak${by}. Silakan lakukan koreksi lalu ajukan ulang.${noteSuffix}`,
    data: {
      timesheetId: input.timesheetId,
      href: '/me/timesheet',
    },
  };
}

export function timesheetRegenerated(
  input: TimesheetEventInput,
): NotificationContent {
  return {
    type: 'TIMESHEET_REGENERATED',
    title: `Timesheet ${input.periodLabel} diperbarui`,
    body: `Data timesheet ${input.periodLabel} diperbarui karena ada koreksi kehadiran yang disetujui. Silakan tinjau kembali sebelum submit.`,
    data: {
      timesheetId: input.timesheetId,
      href: '/me/timesheet',
    },
  };
}

// ---- Fase 32f reminders ---------------------------------------------------

export interface TimesheetReminderInput {
  timesheetId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  /** Days since periodEnd — surfaced in the body so operators reading
   *  the notification archive see the "how urgent" at a glance. */
  daysOverdue: number;
}

export function timesheetSubmitReminder(
  input: TimesheetReminderInput,
): NotificationContent {
  const overdueSuffix =
    input.daysOverdue > 0
      ? ` — sudah ${input.daysOverdue} hari lewat periode.`
      : '';
  return {
    type: 'TIMESHEET_SUBMIT_REMINDER',
    title: `Timesheet ${input.periodLabel} belum di-submit`,
    body: `Silakan tinjau lalu submit timesheet Anda untuk periode ${input.periodLabel} (${input.periodStart} → ${input.periodEnd})${overdueSuffix}`,
    data: {
      timesheetId: input.timesheetId,
      href: '/me/timesheet',
    },
  };
}

export interface TimesheetApprovalReminderInput extends TimesheetReminderInput {
  requesterName: string;
  queue: 'SUPERVISOR' | 'HR';
}

export function timesheetApprovalReminder(
  input: TimesheetApprovalReminderInput,
): NotificationContent {
  const queueLabel = input.queue === 'SUPERVISOR' ? 'supervisor' : 'HR';
  return {
    type: 'TIMESHEET_APPROVAL_REMINDER',
    title: `Timesheet ${input.requesterName} menunggu review ${queueLabel}`,
    body: `Timesheet ${input.periodLabel} (${input.periodStart} → ${input.periodEnd}) dari ${input.requesterName} masih menunggu keputusan Anda — sudah ${input.daysOverdue} hari sejak periode berakhir.`,
    data: {
      timesheetId: input.timesheetId,
      href: '/admin/timesheet',
    },
  };
}

// ---- Fase 32g reopen -----------------------------------------------------

export interface TimesheetReopenedInput {
  timesheetId: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  reopenedByName: string;
  reason: string;
  /** Which audience is receiving this — copy differs. */
  audience: 'OWNER' | 'SUPERVISOR';
  reopenCount: number;
}

export function timesheetReopened(
  input: TimesheetReopenedInput,
): NotificationContent {
  const suffix =
    input.reopenCount > 1
      ? ` Ini adalah reopen ke-${input.reopenCount} untuk periode tersebut.`
      : '';
  const reasonSnippet = `Alasan: "${truncate(input.reason, 200)}".`;
  if (input.audience === 'OWNER') {
    return {
      type: 'TIMESHEET_REOPENED',
      title: `Timesheet ${input.periodLabel} dibuka kembali`,
      body: `Timesheet Anda untuk ${input.periodLabel} (${input.periodStart} → ${input.periodEnd}) dibuka kembali oleh ${input.reopenedByName}. Silakan tinjau, koreksi bila perlu, lalu submit ulang. ${reasonSnippet}${suffix}`,
      data: {
        timesheetId: input.timesheetId,
        href: '/me/timesheet',
      },
    };
  }
  return {
    type: 'TIMESHEET_REOPENED',
    title: `Timesheet ${input.periodLabel} akan kembali ke antrian review`,
    body: `${input.reopenedByName} membuka kembali timesheet ${input.periodLabel} (${input.periodStart} → ${input.periodEnd}) yang sudah APPROVED. Karyawan akan submit ulang; timesheet akan tiba di antrian review Anda kembali. ${reasonSnippet}${suffix}`,
    data: {
      timesheetId: input.timesheetId,
      href: '/admin/timesheet',
    },
  };
}

// ---------------------------------------------------------------------------
// Breach Notification Ledger (Fase 31g)
// ---------------------------------------------------------------------------

export interface BreachDeadlineWarningInput {
  incidentId: string;
  title: string;
  bucket: 'WARNING' | 'CRITICAL' | 'OVERDUE';
  /** Fractional hours; +N means N hours remaining, -N means N hours overdue. */
  hoursRemaining: number;
  deadlineAt: string;
}

export function breachDeadlineWarning(
  input: BreachDeadlineWarningInput,
): NotificationContent {
  const hrs = Math.abs(input.hoursRemaining).toFixed(1);
  const timeCopy =
    input.bucket === 'OVERDUE'
      ? `sudah TERLEWAT ${hrs} jam sejak batas 72 jam UU PDP`
      : `sisa ${hrs} jam sebelum batas 72 jam UU PDP`;
  const urgency =
    input.bucket === 'OVERDUE'
      ? 'DEADLINE TERLEWAT'
      : input.bucket === 'CRITICAL'
        ? 'DEADLINE < 4 JAM'
        : 'DEADLINE < 24 JAM';
  return {
    type: 'BREACH_DEADLINE_WARNING',
    title: `[${urgency}] ${truncate(input.title, 80)}`,
    body: `Insiden pelanggaran data "${truncate(input.title, 120)}" ${timeCopy} (deadline: ${input.deadlineAt}). Segera notifikasi Kominfo & subjek data terdampak.`,
    data: {
      incidentId: input.incidentId,
      bucket: input.bucket,
      href: `/admin/security/breaches/${input.incidentId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Retention Enforcement Audit (OPS-6)
// ---------------------------------------------------------------------------

export interface RetentionAuditGapInput {
  reportId: string;
  /** e.g. `Maret 2026`. */
  periodLabel: string;
  status: 'GAP_DETECTED' | 'WORKER_INACTIVE';
  findingCount: number;
}

export function retentionAuditGap(
  input: RetentionAuditGapInput,
): NotificationContent {
  const urgency =
    input.status === 'WORKER_INACTIVE'
      ? 'WORKER TIDAK BERJALAN'
      : 'DITEMUKAN GAP';
  const detail =
    input.status === 'WORKER_INACTIVE'
      ? `RetentionWorker tidak berjalan sama sekali pada periode ${input.periodLabel}. Cek kill switch RETENTION_WORKER_ENABLED dan cron harian 02:00 UTC.`
      : `Audit retention ${input.periodLabel} menemukan ${input.findingCount} temuan (data yang seharusnya sudah dihapus tapi masih tersisa). Buka laporan untuk detail dan tindak lanjut.`;
  return {
    type: 'RETENTION_AUDIT_GAP_DETECTED',
    title: `[Retention Audit — ${urgency}] ${input.periodLabel}`,
    body: detail,
    data: {
      reportId: input.reportId,
      status: input.status,
      href: `/admin/privacy/retention/audit-reports/${input.reportId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Vendor / Processor Register (Fase 31f)
// ---------------------------------------------------------------------------

export interface VendorReviewDueInput {
  vendorId: string;
  vendorName: string;
  daysUntil: number;
  /** ISO-8601 timestamp string of the nextReviewAt cutoff. */
  reviewCutoff: string;
}

export function vendorReviewDue(input: VendorReviewDueInput): NotificationContent {
  const overdue = input.daysUntil < 0;
  const urgency = overdue ? 'REVIEW TERLAMBAT' : 'REVIEW SEGERA';
  const detail = overdue
    ? `Vendor "${truncate(input.vendorName, 80)}" sudah melewati cutoff review (T+${Math.abs(input.daysUntil)} hari). Segera buka halaman vendor untuk memperbarui review atau perpanjang DPA.`
    : `Vendor "${truncate(input.vendorName, 80)}" akan mencapai cutoff review dalam ${input.daysUntil} hari. Buka halaman vendor untuk konfirmasi review + perbarui subprocessor list bila ada perubahan.`;
  return {
    type: 'VENDOR_REVIEW_DUE',
    title: `[Vendor — ${urgency}] ${truncate(input.vendorName, 60)}`,
    body: detail,
    data: {
      vendorId: input.vendorId,
      daysUntil: input.daysUntil,
      reviewCutoff: input.reviewCutoff,
      href: `/admin/privacy/vendors/${input.vendorId}`,
    },
  };
}

export interface VendorContractExpiringInput {
  vendorId: string;
  vendorName: string;
  daysUntil: number;
  /** ISO-8601 timestamp string of the contractEndAt cutoff. */
  contractEnd: string;
}

export function vendorContractExpiring(
  input: VendorContractExpiringInput,
): NotificationContent {
  const overdue = input.daysUntil < 0;
  const urgency = overdue ? 'KONTRAK KADALUARSA' : 'KONTRAK HAMPIR HABIS';
  const detail = overdue
    ? `Kontrak dengan vendor "${truncate(input.vendorName, 80)}" sudah kadaluarsa sejak ${Math.abs(input.daysUntil)} hari yang lalu. Vendor masih berstatus AKTIF — segera negosiasikan perpanjangan atau ubah status menjadi DEPRECATED / TERMINATED.`
    : `Kontrak dengan vendor "${truncate(input.vendorName, 80)}" akan berakhir dalam ${input.daysUntil} hari. Mulai proses negosiasi renewal sekarang; siklus procurement Indonesia biasanya butuh 45+ hari.`;
  return {
    type: 'VENDOR_CONTRACT_EXPIRING',
    title: `[Vendor — ${urgency}] ${truncate(input.vendorName, 60)}`,
    body: detail,
    data: {
      vendorId: input.vendorId,
      daysUntil: input.daysUntil,
      contractEnd: input.contractEnd,
      href: `/admin/privacy/vendors/${input.vendorId}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
