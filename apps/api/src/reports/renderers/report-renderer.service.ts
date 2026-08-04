import { PassThrough } from 'node:stream';

import { Injectable, Logger } from '@nestjs/common';
import { ScheduledReportType } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { AnalyticsSnapshotService } from '../../analytics/analytics-snapshot.service';
import { DpiaService } from '../../dpia/dpia.service';
import { renderDpiaPdf } from '../../dpia/renderers/dpia-pdf-renderer';
import { PrismaService } from '../../prisma/prisma.service';
import { renderRopaPdf } from '../../ropa/renderers/ropa-pdf-renderer';
import { RopaExportService } from '../../ropa/ropa-export.service';
import { metricDescriptor, validateDefinition } from '../domain/custom-report-definition';
import type { RenderedReport } from '../domain/report-registry';
import { ReportBuilderService } from '../report-builder.service';
import { SavedReportService } from '../saved-report.service';


/**
 * Fase 33c — resolves a `ScheduledReportType` to a rendered `Buffer`.
 *
 * The dispatcher passes the tenant's `companyId` + `now`, and we
 * return the PDF bytes + a short human summary that will be embedded
 * in the email body. The renderer never writes to the DB — the
 * scheduler owns the audit trail.
 */
@Injectable()
export class ReportRendererService {
  private readonly logger = new Logger(ReportRendererService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ropaExport: RopaExportService,
    private readonly dpiaService: DpiaService,
    private readonly analytics: AnalyticsSnapshotService,
    private readonly savedReport: SavedReportService,
    private readonly builder: ReportBuilderService,
  ) {}

  async render(
    companyId: string,
    type: ScheduledReportType,
    now: Date,
    opts: { savedReportId?: string | null } = {},
  ): Promise<RenderedReport> {
    switch (type) {
      case 'ROPA':
        return this.renderRopa(companyId, now);
      case 'DPIA':
        return this.renderDpia(companyId, now);
      case 'TIMESHEET_SUMMARY':
        return this.renderTimesheetSummary(companyId, now);
      case 'ANALYTICS_SNAPSHOT':
        return this.renderAnalyticsSnapshot(companyId, now);
      case 'CUSTOM':
        if (!opts.savedReportId) {
          throw new Error('CUSTOM_REPORT_MISSING_SAVED_ID');
        }
        return this.renderCustom(companyId, opts.savedReportId, now);
    }
  }

  private async renderCustom(
    companyId: string,
    savedReportId: string,
    now: Date,
  ): Promise<RenderedReport> {
    const row = await this.prisma.savedReport.findFirst({
      where: { id: savedReportId, companyId },
    });
    if (!row) throw new Error('CUSTOM_REPORT_SAVED_NOT_FOUND');
    const def = validateDefinition(row.definition);
    const result = await this.builder.execute(companyId, def, now);
    const md = metricDescriptor(def.metric);

    // Ship CSV in the scheduled email because it round-trips smaller
    // than XLSX and lends itself to spreadsheet paste. The FE
    // /admin/reports/custom retains the XLSX option for on-demand
    // downloads.
    const header = ['key', 'label', md.label];
    const lines: string[] = [
      `# ${row.name}`,
      `# dimension=${def.dimension} metric=${def.metric} windowDays=${def.filter.windowDays}`,
      header.map(csvField).join(','),
    ];
    for (const r of result.rows) {
      lines.push(
        [
          csvField(r.key),
          csvField(r.label ?? ''),
          csvField(r.value.toFixed(md.fractionDigits)),
        ].join(','),
      );
    }
    const csv = '\uFEFF' + lines.join('\r\n') + '\r\n';
    return {
      filename: `custom-${row.id}-${now.toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv; charset=utf-8',
      bytes: Buffer.from(csv, 'utf-8'),
      summary: `Custom report "${row.name}" — ${result.rows.length} rows.`,
    };
    // Silence unused-import warning; savedReport service is exposed
    // via the module in case downstream code wants direct access.
    void this.savedReport;
  }

  private async renderRopa(companyId: string, now: Date): Promise<RenderedReport> {
    // Reuse the existing ROPA renderer with the same buffer-first shape.
    // We call directly into the low-level `renderRopaPdf` because we
    // want to bypass the "audit-before-stream" wrapper — the scheduler
    // writes its own delivery-log row that captures the same hash.
    const activities = await this.prisma.ropaActivity.findMany({
      where: { companyId, currentVersionId: { not: null } },
      include: { currentVersion: true },
      orderBy: { slug: 'asc' },
    });
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    const rows = activities
      .filter((a) => a.currentVersion)
      .map((a) => ({ ...a.currentVersion!, slug: a.slug }));
    const bytes = await renderRopaPdf(
      {
        companyName: company?.name ?? '(unknown)',
        generatedAt: now,
        generatedByEmail: 'scheduler@workpulse.system',
      },
      rows,
    );
    // Silence "ropaExport unused" — kept in the DI graph because 33b
    // may re-attach to it (dashboards will surface last-export freshness).
    void this.ropaExport;
    return {
      filename: `ropa-${now.toISOString().slice(0, 10)}.pdf`,
      mimeType: 'application/pdf',
      bytes,
      summary: `ROPA snapshot: ${rows.length} aktivitas PUBLISHED per ${now.toISOString().slice(0, 10)}.`,
    };
  }

  private async renderDpia(companyId: string, now: Date): Promise<RenderedReport> {
    // A single DPIA per PDF is the norm from the export endpoint. For
    // the scheduled digest we pick the most-recent APPROVED — DPOs
    // asked for "the latest signed DPIA per month", not a compilation.
    // If there are zero APPROVED, we ship a "no DPIA available"
    // placeholder so the delivery still succeeds (an empty attachment
    // would spook the mail gateway).
    const approved = await this.dpiaService.listApproved(companyId);
    if (approved.length === 0) {
      return renderPlaceholder(
        now,
        'dpia-empty',
        'Belum ada DPIA APPROVED di tenant ini. Buat + approve DPIA di /admin/dpia.',
      );
    }
    const latest = approved[0]!;
    const activity = await this.prisma.ropaActivity.findUnique({
      where: { id: latest.ropaActivityId },
      include: { currentVersion: true },
    });
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    const bytes = await renderDpiaPdf(
      {
        companyName: company?.name ?? '(unknown)',
        generatedAt: now,
        ropaActivitySlug: activity?.slug ?? 'unknown',
        ropaActivityName: activity?.currentVersion?.name ?? activity?.slug ?? 'unknown',
      },
      latest,
    );
    return {
      filename: `dpia-${latest.ropaActivityId}-${now.toISOString().slice(0, 10)}.pdf`,
      mimeType: 'application/pdf',
      bytes,
      summary: `DPIA terbaru: "${latest.title}" (${latest.riskItems.length} risk items).`,
    };
  }

  private async renderTimesheetSummary(companyId: string, now: Date): Promise<RenderedReport> {
    // Deliberately narrow shape: count of DRAFT + PENDING + APPROVED
    // timesheets and hours totals across all users for the previous
    // 30 days. A full XLSX is available via the timesheet export
    // module — the scheduled version is a quick summary.
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.timesheet.findMany({
      where: {
        companyId,
        period: { periodEnd: { gte: since } },
      },
      include: {
        period: { select: { periodStart: true, periodEnd: true } },
        user: { select: { fullName: true, email: true } },
      },
      orderBy: [{ periodId: 'desc' }, { userId: 'asc' }],
    });
    const summary = summariseTimesheets(rows);
    const bytes = await renderKeyValuePdf(
      'Timesheet Summary (30 hari)',
      Object.entries(summary),
      now,
    );
    return {
      filename: `timesheet-summary-${now.toISOString().slice(0, 10)}.pdf`,
      mimeType: 'application/pdf',
      bytes,
      summary: `Timesheet 30 hari: ${rows.length} rows, ${summary['Total hours']}.`,
    };
  }

  private async renderAnalyticsSnapshot(companyId: string, now: Date): Promise<RenderedReport> {
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.analyticsSnapshot.findMany({
      where: { companyId, date: { gte: since } },
      orderBy: [{ date: 'desc' }, { metricKey: 'asc' }],
    });
    if (rows.length === 0) {
      return renderPlaceholder(
        now,
        'analytics-empty',
        'Belum ada snapshot analytics untuk 30 hari terakhir.',
      );
    }
    const grouped: Array<[string, string]> = [];
    const byMetric = new Map<string, { count: number; sum: number }>();
    for (const r of rows) {
      const bucket = byMetric.get(r.metricKey) ?? { count: 0, sum: 0 };
      bucket.count += 1;
      bucket.sum += Number(r.value.toString());
      byMetric.set(r.metricKey, bucket);
    }
    for (const [k, v] of byMetric) {
      grouped.push([k, `avg = ${(v.sum / v.count).toFixed(2)} (n=${v.count} hari)`]);
    }
    const bytes = await renderKeyValuePdf('Analytics Snapshot (30 hari terakhir)', grouped, now);
    void this.analytics;
    return {
      filename: `analytics-snapshot-${now.toISOString().slice(0, 10)}.pdf`,
      mimeType: 'application/pdf',
      bytes,
      summary: `Analytics snapshot: ${grouped.length} metrics, ${rows.length} rows.`,
    };
  }
}

// ---------- Local helpers ----------

function summariseTimesheets(
  rows: Array<{
    status: string;
    totalRegularHours: unknown;
    totalOvertimeHours: unknown;
  }>,
): Record<string, string> {
  const statusCounts = new Map<string, number>();
  let regular = 0;
  let overtime = 0;
  for (const r of rows) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
    // Prisma Decimal → number via string round-trip.
    regular += Number((r.totalRegularHours as { toString(): string }).toString());
    overtime += Number((r.totalOvertimeHours as { toString(): string }).toString());
  }
  const out: Record<string, string> = {
    'Total timesheets': String(rows.length),
    'Total regular hours': `${regular.toFixed(2)} h`,
    'Total overtime hours': `${overtime.toFixed(2)} h`,
  };
  for (const [k, v] of statusCounts) {
    out[`Status: ${k}`] = String(v);
  }
  return out;
}

function csvField(v: string): string {
  if (/[,"\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

async function renderPlaceholder(
  now: Date,
  slug: string,
  message: string,
): Promise<RenderedReport> {
  const bytes = await renderKeyValuePdf(
    'Report — no data',
    [
      ['Generated', now.toISOString()],
      ['Message', message],
    ],
    now,
  );
  return {
    filename: `${slug}-${now.toISOString().slice(0, 10)}.pdf`,
    mimeType: 'application/pdf',
    bytes,
    summary: message,
  };
}

/**
 * Minimalist PDF renderer for tabular key-value data. Deliberately
 * stripped-down so the scheduler stays a small, well-defined surface.
 * If we ever need branded styling we can extend this in-place.
 */
async function renderKeyValuePdf(
  title: string,
  rows: Iterable<readonly [string, string]>,
  generatedAt: Date,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
    });
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    doc.on('error', reject);
    doc.pipe(sink);

    doc.font('Helvetica-Bold').fontSize(18).text(title);
    doc.moveDown(0.25);
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#555')
      .text(`Digenerate: ${generatedAt.toISOString()}`);
    doc.moveDown(0.75);
    doc.fillColor('#000');
    for (const [k, v] of rows) {
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(k, { continued: true })
        .font('Helvetica')
        .text(`  ${v}`);
    }
    doc.end();
  });
}
