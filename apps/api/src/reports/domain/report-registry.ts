import type { ScheduledReportType } from '@prisma/client';

/**
 * Fase 33c — registry entry for a "runnable report".
 *
 * Each entry declares:
 *   - `type` — the enum discriminant.
 *   - `label` — human-facing label used in the FE picker.
 *   - `description` — one-liner shown to the DPO when choosing the
 *     report type.
 *   - `mimeType` + `extension` — determines the attachment metadata.
 *
 * The concrete rendering function lives in the module that owns the
 * data (ROPA renders itself, DPIA renders itself, etc.). The dispatcher
 * (`ReportSchedulerService`) resolves the renderer by `type` via a
 * runtime map registered inside `ReportsModule`.
 */

export interface RenderedReport {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  /** Short human summary for the email body. */
  summary: string;
}

export interface ReportRegistryEntry {
  readonly type: ScheduledReportType;
  readonly label: string;
  readonly description: string;
}

export const REPORT_REGISTRY: ReadonlyArray<ReportRegistryEntry> = [
  {
    type: 'TIMESHEET_SUMMARY',
    label: 'Timesheet — ringkasan periode aktif',
    description: 'Rekap timesheet karyawan pada periode berjalan (hours, absensi, overtime).',
  },
  {
    type: 'ROPA',
    label: 'ROPA — register PUBLISHED',
    description:
      'Register kegiatan pemrosesan yang berstatus PUBLISHED, format PDF regulator-friendly.',
  },
  {
    type: 'DPIA',
    label: 'DPIA — semua APPROVED',
    description: 'Kompilasi assessment DPIA yang berstatus APPROVED beserta risk register-nya.',
  },
  {
    type: 'ANALYTICS_SNAPSHOT',
    label: 'Analytics — snapshot 30 hari',
    description:
      'Snapshot KPI 30 hari terakhir dari executive dashboard (attendance, leave, OT, headcount).',
  },
];

export function labelFor(type: ScheduledReportType): string {
  return REPORT_REGISTRY.find((r) => r.type === type)?.label ?? String(type);
}
