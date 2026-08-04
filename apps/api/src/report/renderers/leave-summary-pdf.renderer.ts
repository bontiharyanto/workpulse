import PDFDocument from 'pdfkit';

import type {
  LeaveSummaryReportRow,
  LeaveSummaryTotals,
} from '../domain/leave-summary-report';

import type { RendererStream } from './render-context';

interface Column {
  key: keyof LeaveSummaryReportRow;
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

/** Total ≈ 535pt — fits A4 portrait (595pt) with 30pt margins. */
const COLUMNS: readonly Column[] = [
  { key: 'userFullName', label: 'Karyawan', width: 110, align: 'left' },
  { key: 'departmentName', label: 'Departemen', width: 90, align: 'left' },
  { key: 'leaveTypeCode', label: 'Kode', width: 45, align: 'left' },
  { key: 'leaveTypeName', label: 'Tipe', width: 85, align: 'left' },
  { key: 'quota', label: 'Kuota', width: 40, align: 'right' },
  { key: 'carriedOver', label: 'Carry', width: 40, align: 'right' },
  { key: 'used', label: 'Pakai', width: 40, align: 'right' },
  { key: 'reserved', label: 'Res.', width: 40, align: 'right' },
  { key: 'remaining', label: 'Sisa', width: 45, align: 'right' },
];

export function renderLeaveSummaryPdf(
  rows: ReadonlyArray<LeaveSummaryReportRow>,
  totals: LeaveSummaryTotals,
  stream: RendererStream,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
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

    for (const r of rows) {
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
  doc.text(
    `Dicetak: ${s.header.generatedAt.toISOString()} · Oleh: ${s.header.generatedByEmail}`,
  );
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

function drawDataRow(doc: PDFKit.PDFDocument, r: LeaveSummaryReportRow): void {
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font('Helvetica').fontSize(8);
  for (const col of COLUMNS) {
    const value = r[col.key];
    const text = value === null || value === undefined ? '' : String(value);
    doc.text(text, x + 2, y + 2, { width: col.width - 4, align: col.align });
    x += col.width;
  }
  doc.y = y + 14;
}

function drawTotals(doc: PDFKit.PDFDocument, t: LeaveSummaryTotals): void {
  doc.moveDown(0.8);
  doc.font('Helvetica-Bold').fontSize(9).text('Total');
  doc.font('Helvetica').fontSize(9);
  doc.text(`Karyawan: ${t.users} · Tipe cuti: ${t.leaveTypes}`);
  doc.text(
    `Σ Kuota (kuota+carry): ${t.totalQuota} · Σ Terpakai: ${t.totalUsed} · Σ Reserved: ${t.totalReserved} · Σ Sisa: ${t.totalRemaining}`,
  );
}
