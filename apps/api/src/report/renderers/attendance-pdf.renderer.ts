import PDFDocument from 'pdfkit';

import type { AttendanceReportRow, AttendanceReportSummary } from '../domain/attendance-report';

import type { RendererStream } from './render-context';

interface Column {
  key: keyof AttendanceReportRow;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

/**
 * Columns tuned for A4 landscape (842 × 595pt). Total width ≈ 782pt with
 * 30pt margins on each side of the print area.
 */
const COLUMNS: readonly Column[] = [
  { key: 'workDate', label: 'Tanggal', width: 70, align: 'left' },
  { key: 'userFullName', label: 'Karyawan', width: 130, align: 'left' },
  { key: 'departmentName', label: 'Departemen', width: 90, align: 'left' },
  { key: 'shiftName', label: 'Shift', width: 80, align: 'left' },
  { key: 'clockIn', label: 'Masuk', width: 55, align: 'right' },
  { key: 'clockOut', label: 'Keluar', width: 55, align: 'right' },
  { key: 'hoursWorked', label: 'Jam', width: 45, align: 'right' },
  { key: 'status', label: 'Status', width: 75, align: 'left' },
  { key: 'lateMinutes', label: 'Late', width: 45, align: 'right' },
  { key: 'earlyLeaveMinutes', label: 'Cepat', width: 55, align: 'right' },
];

export function renderAttendancePdf(
  rows: ReadonlyArray<AttendanceReportRow>,
  summary: AttendanceReportSummary,
  stream: RendererStream,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      layout: 'landscape',
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 30, right: 30 },
      info: { Title: stream.header.title, Author: 'Workpulse' },
    });

    stream.target.on('error', reject);
    doc.on('error', reject);
    doc.on('end', resolve);
    doc.pipe(stream.target);

    drawTitle(doc, stream);
    drawHeaderRow(doc);

    for (const row of rows) {
      if (doc.y > doc.page.height - 60) {
        doc.addPage();
        drawTitle(doc, stream);
        drawHeaderRow(doc);
      }
      drawDataRow(doc, row);
    }

    drawSummary(doc, summary);
    doc.end();
  });
}

function drawTitle(doc: PDFKit.PDFDocument, s: RendererStream): void {
  doc.fillColor('#000');
  doc.font('Helvetica-Bold').fontSize(14).text(`${s.header.title} — ${s.header.companyName}`);
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(s.header.subtitle);
  doc.text(
    `Dicetak: ${s.header.generatedAt.toISOString()} · Oleh: ${s.header.generatedByEmail} · Zona: ${s.header.timezone}`,
  );
  doc.fillColor('#000').moveDown(0.5);
}

function drawHeaderRow(doc: PDFKit.PDFDocument): void {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000');
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

function drawDataRow(doc: PDFKit.PDFDocument, r: AttendanceReportRow): void {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(8).fillColor('#000');
  for (const col of COLUMNS) {
    const raw = r[col.key];
    const text = raw === null || raw === undefined ? '' : String(raw);
    doc.text(text, x + 2, y + 2, { width: col.width - 4, align: col.align });
    x += col.width;
  }
  doc.y = y + 14;
}

function drawSummary(doc: PDFKit.PDFDocument, s: AttendanceReportSummary): void {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  doc.text('Ringkasan');
  doc.font('Helvetica').fontSize(9);
  doc.text(
    `Total baris: ${s.totalRows} · On-time: ${s.onTime} · Late: ${s.late} · Absent: ${s.absent} · Cuti: ${s.onLeave}`,
  );
  doc.text(`Σ Jam kerja: ${s.totalHours}h · Σ Menit telat: ${s.totalLateMinutes}m`);
}
