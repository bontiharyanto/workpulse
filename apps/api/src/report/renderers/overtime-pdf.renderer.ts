import PDFDocument from 'pdfkit';

import type { RendererStream } from './render-context';
import type { OvertimeReportRow, OvertimeReportTotals } from '../domain/overtime-report';


interface Column {
  key: keyof OvertimeReportRow;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
  format?: (v: unknown) => string;
}

/**
 * Total ≈ 780pt — fits A4 landscape (842pt) with 30pt margins on each side.
 * Layout is denser than portrait but avoids awkward wrapping of currency
 * values, which is the whole point of the overtime report.
 */
const COLUMNS: readonly Column[] = [
  { key: 'userFullName', label: 'Karyawan', width: 110, align: 'left' },
  { key: 'departmentName', label: 'Departemen', width: 90, align: 'left' },
  { key: 'workDate', label: 'Tanggal', width: 65, align: 'center' },
  { key: 'dayKind', label: 'Jenis', width: 55, align: 'center' },
  { key: 'hours', label: 'Jam', width: 40, align: 'right', format: fmtNumber },
  { key: 'ratePerHour', label: 'Tarif/Jam', width: 90, align: 'right', format: fmtCurrency },
  { key: 'totalAmount', label: 'Total', width: 100, align: 'right', format: fmtCurrency },
  { key: 'status', label: 'Status', width: 90, align: 'left' },
  { key: 'reason', label: 'Alasan', width: 140, align: 'left' },
];

export function renderOvertimePdf(
  rows: ReadonlyArray<OvertimeReportRow>,
  totals: OvertimeReportTotals,
  stream: RendererStream,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: { top: 40, bottom: 40, left: 30, right: 30 },
      info: { Title: stream.header.title, Author: 'Workpulse' },
    });

    stream.target.on('error', reject);
    doc.on('error', reject);
    doc.on('end', resolve);
    doc.pipe(stream.target);

    drawTitle(doc, stream);
    drawHeaderRow(doc);

    for (const r of rows) {
      // Reserve room for the totals footer to avoid orphaning it on its own
      // page — keep two lines of buffer below current cursor.
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        drawTitle(doc, stream);
        drawHeaderRow(doc);
      }
      drawDataRow(doc, r);
    }

    drawTotals(doc, totals);
    doc.end();
  });
}

function drawTitle(doc: PDFKit.PDFDocument, s: RendererStream): void {
  doc.fillColor('#000');
  doc.font('Helvetica-Bold').fontSize(14).text(`${s.header.title} — ${s.header.companyName}`);
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(s.header.subtitle);
  doc.text(`Dicetak: ${s.header.generatedAt.toISOString()} · Oleh: ${s.header.generatedByEmail}`);
  doc.fillColor('#000').moveDown(0.5);
}

function drawHeaderRow(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(8);
  for (const col of COLUMNS) {
    doc.text(col.label, x + 2, y + 3, { width: col.width - 4, align: col.align });
    x += col.width;
  }
  doc
    .moveTo(doc.page.margins.left, y + 16)
    .lineTo(doc.page.width - doc.page.margins.right, y + 16)
    .strokeColor('#999')
    .lineWidth(0.5)
    .stroke();
  doc.y = y + 18;
}

function drawDataRow(doc: PDFKit.PDFDocument, r: OvertimeReportRow): void {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(8);
  for (const col of COLUMNS) {
    const raw = r[col.key];
    const text = col.format
      ? col.format(raw)
      : raw === null || raw === undefined
        ? ''
        : String(raw);
    doc.text(text, x + 2, y + 2, { width: col.width - 4, align: col.align });
    x += col.width;
  }
  doc.y = y + 14;
}

function drawTotals(doc: PDFKit.PDFDocument, t: OvertimeReportTotals): void {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(10).text('Ringkasan');
  doc.font('Helvetica').fontSize(9);
  doc.text(
    `Pengajuan: ${t.requestCount} · Karyawan: ${t.users} · Σ Jam: ${fmtNumber(t.totalHours)} · Σ Total: ${fmtCurrency(t.totalAmount)}`,
  );
  doc.text(
    `Jam per jenis — Hari kerja: ${fmtNumber(t.hoursByDayKind.WEEKDAY)} · Akhir pekan: ${fmtNumber(t.hoursByDayKind.WEEKEND)} · Hari libur: ${fmtNumber(t.hoursByDayKind.HOLIDAY)}`,
  );
  doc.text(
    `Total per jenis — Hari kerja: ${fmtCurrency(t.amountByDayKind.WEEKDAY)} · Akhir pekan: ${fmtCurrency(t.amountByDayKind.WEEKEND)} · Hari libur: ${fmtCurrency(t.amountByDayKind.HOLIDAY)}`,
  );
}

function fmtCurrency(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtNumber(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '';
  return v.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}
