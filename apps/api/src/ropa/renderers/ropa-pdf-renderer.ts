import { PassThrough } from 'node:stream';

import PDFDocument from 'pdfkit';

import type { RopaExportHeader, RopaExportRow } from './ropa-export-types';

/**
 * Fase 31d — regulator-facing PDF export.
 *
 * Layout intent: one section per activity, no table jam-pack. Regulators
 * read this on paper; being able to skim by activity name matters more
 * than saving page count.
 *
 * We buffer the output because the export service SHA-256s the bytes
 * BEFORE the audit row commits (same pattern as timesheet export).
 * `PDFDocument` is a `Readable`, so we pipe into a PassThrough and
 * accumulate chunks in a Buffer.
 */
export async function renderRopaPdf(
  header: RopaExportHeader,
  rows: readonly RopaExportRow[],
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      info: {
        Title: `ROPA — ${header.companyName}`,
        Author: 'Workpulse',
      },
    });

    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => chunks.push(chunk));
    sink.on('error', reject);
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.pipe(sink);

    drawTitleBlock(doc, header, rows.length);

    if (rows.length === 0) {
      doc
        .moveDown(2)
        .font('Helvetica-Oblique')
        .fontSize(11)
        .fillColor('#555')
        .text(
          'Belum ada aktivitas pemrosesan yang PUBLISHED. Jalankan "Seed defaults" atau buat versi baru, lalu publish sebelum melakukan export ini untuk regulator.',
        );
    }

    rows.forEach((row, idx) => {
      if (idx > 0) doc.addPage();
      drawActivity(doc, row);
    });

    doc.end();
  });
}

function drawTitleBlock(
  doc: PDFKit.PDFDocument,
  header: RopaExportHeader,
  count: number,
): void {
  doc
    .fillColor('#000')
    .font('Helvetica-Bold')
    .fontSize(18)
    .text('Record of Processing Activities (ROPA)');
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#333')
    .text('Register Kegiatan Pemrosesan Data Pribadi');
  doc.moveDown(0.5);
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor('#000')
    .text(header.companyName);
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text(
    `Dicetak: ${header.generatedAt.toISOString()} · Oleh: ${header.generatedByEmail}`,
  );
  doc.text(`Total aktivitas terpublikasi: ${count}`);
  doc.text(
    'Landasan hukum: Pasal 31 UU 27/2022 PDP; GDPR Art. 30 (untuk paralel EU).',
  );
  doc.moveDown(0.8);
  doc
    .strokeColor('#999')
    .lineWidth(0.5)
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.5);
}

function drawActivity(doc: PDFKit.PDFDocument, row: RopaExportRow): void {
  const left = doc.page.margins.left;
  doc
    .fillColor('#000')
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(row.name, left);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#666')
    .text(
      `slug: ${row.slug} · versi ${row.version} · dipublikasi ${row.publishedAt ? row.publishedAt.toISOString() : '-'}`,
    );
  doc.moveDown(0.6);

  field(doc, 'Tujuan Pemrosesan', row.purpose);
  field(
    doc,
    'Landasan Hukum',
    row.legalBasisDetail
      ? `${row.legalBasis} — ${row.legalBasisDetail}`
      : row.legalBasis,
  );
  field(doc, 'Kategori Data', formatList(row.dataCategories));
  field(doc, 'Kategori Subjek Data', formatList(row.subjectCategories));
  field(doc, 'Penerima Data', formatList(row.recipients));
  field(doc, 'Periode Retensi', row.retentionPeriod);
  field(
    doc,
    'Transfer Lintas Batas',
    row.crossBorderTransfer
      ? `Ya — ${row.crossBorderDetail ?? 'detail belum dilengkapi.'}`
      : 'Tidak',
  );
  field(doc, 'Langkah Pengamanan', row.securityMeasures);
  if (row.notes) field(doc, 'Catatan', row.notes);
}

function field(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc.moveDown(0.35);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#000')
    .text(label, { continued: false });
  doc.font('Helvetica').fontSize(10).fillColor('#222').text(value, {
    align: 'left',
    lineGap: 1,
  });
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return '—';
  // Numbered list — regulators score readability.
  return items.map((v, i) => `${i + 1}. ${v}`).join('\n');
}
