import { PassThrough } from 'node:stream';

import { BreachIncident, BreachSeverity, BreachTimelineEvent } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { snapshot } from '../domain/deadline';

export interface BreachPdfHeader {
  companyName: string;
  generatedAt: Date;
  generatedByEmail: string;
}

type WithTimeline = BreachIncident & {
  timeline: (BreachTimelineEvent & { actor: { email: string } | null })[];
  reportedBy: { email: string } | null;
  assignedTo: { email: string } | null;
};

/**
 * Fase 31g — regulator-facing PDF for a breach incident.
 *
 * Layout matches the UU 27/2022 PDP Pasal 46 + GDPR Art. 33 template
 * expected by Kominfo / DPAs:
 *
 *   1. Metadata (perusahaan, tanggal generate, DPO)
 *   2. Ringkasan insiden (title, severity, category, dampak)
 *   3. Kronologi (detected, contained, notified authority, subjects, closed)
 *   4. Tindakan (containment, root cause, remediation)
 *   5. Notifikasi (authorityRef, subjectTemplate excerpt)
 *   6. Timeline lengkap (append-only ledger)
 *
 * Buffered so `BreachExportService` can SHA-256 + audit BEFORE
 * streaming to the client.
 */
export async function renderBreachPdf(
  header: BreachPdfHeader,
  incident: WithTimeline,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      info: {
        Title: `Breach Incident — ${incident.title}`,
        Author: 'Workpulse',
      },
    });

    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (c: Buffer) => chunks.push(c));
    sink.on('error', reject);
    sink.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.pipe(sink);

    drawTitle(doc, header, incident);
    drawSummary(doc, incident);
    drawChronology(doc, incident);
    drawActions(doc, incident);
    drawNotifications(doc, incident);
    drawTimeline(doc, incident);

    doc.end();
  });
}

function drawTitle(doc: PDFKit.PDFDocument, header: BreachPdfHeader, b: WithTimeline): void {
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#000').text('Breach Notification Report');
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#333')
    .text('Laporan Pelanggaran Pelindungan Data Pribadi');
  doc
    .font('Helvetica-Oblique')
    .fontSize(9)
    .fillColor('#666')
    .text('UU 27/2022 Pasal 46 ayat (3) · GDPR Art. 33 / 34');
  doc.moveDown(0.5);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#555')
    .text(`Perusahaan: ${header.companyName}`)
    .text(`Digenerate: ${header.generatedAt.toISOString()}`)
    .text(`Diminta oleh: ${header.generatedByEmail}`);
  doc.moveDown(0.75);
  doc.strokeColor('#000').lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(b.title);
  doc.moveDown(0.75);
}

function drawSummary(doc: PDFKit.PDFDocument, b: WithTimeline): void {
  section(doc, 'Ringkasan');
  const snap = snapshot(b.detectedAt, b.status);
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(severityColour(b.severity))
    .text(`Severity: ${b.severity}`)
    .fillColor('#000')
    .text(`Kategori: ${b.category}`)
    .text(`Status: ${b.status}`)
    .text(`Terdampak: ${b.affectedUserCount} data subjek (approx)`)
    .text(`Kategori data: ${b.affectedDataCategories.join(', ') || '—'}`)
    .text(`Sistem: ${b.affectedSystems.join(', ') || '—'}`)
    .fillColor(snap.overdue ? '#991b1b' : '#166534')
    .text(
      `Deadline 72 jam: ${snap.deadlineAt.toISOString()} — ${
        snap.overdue
          ? `OVERDUE by ${Math.abs(snap.hoursRemaining).toFixed(1)}h`
          : `${snap.hoursRemaining.toFixed(1)}h remaining`
      }`,
    )
    .fillColor('#000');
  doc.moveDown(0.25);
  paragraph(doc, b.description);
}

function drawChronology(doc: PDFKit.PDFDocument, b: WithTimeline): void {
  section(doc, 'Kronologi');
  const rows: Array<[string, Date | null]> = [
    ['Terjadi (occurred)', b.occurredAt],
    ['Terdeteksi (detected)', b.detectedAt],
    ['Dikontrol (contained)', b.containedAt],
    ['Notifikasi Otoritas (Kominfo)', b.authorityNotifiedAt],
    ['Notifikasi Subjek Data', b.subjectsNotifiedAt],
    ['Ditutup (closed)', b.closedAt],
  ];
  rows.forEach(([label, dt]) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#333')
      .text(`${label}:`, { continued: true })
      .font('Helvetica')
      .text(` ${dt ? dt.toISOString() : '—'}`);
  });
  doc.moveDown(0.5);
}

function drawActions(doc: PDFKit.PDFDocument, b: WithTimeline): void {
  section(doc, 'Tindakan Pencegahan & Pemulihan');
  bullet(doc, 'Containment', b.containmentActions || '—');
  bullet(doc, 'Root cause', b.rootCause ?? '—');
  bullet(doc, 'Remediation / Post-Mortem', b.remediation ?? '—');
}

function drawNotifications(doc: PDFKit.PDFDocument, b: WithTimeline): void {
  section(doc, 'Notifikasi');
  bullet(doc, 'Nomor Referensi Otoritas', b.authorityNotificationRef ?? '—');
  bullet(
    doc,
    'Template Notifikasi Subjek Data',
    (b.subjectNotificationTemplate ?? '—').slice(0, 500),
  );
}

function drawTimeline(doc: PDFKit.PDFDocument, b: WithTimeline): void {
  section(doc, 'Timeline (Append-only Ledger)');
  if (b.timeline.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor('#555')
      .text('Belum ada event pada timeline.');
    return;
  }
  b.timeline.forEach((ev) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#000')
      .text(`${ev.occurredAt.toISOString()} · ${ev.eventType}`, {
        continued: true,
      })
      .font('Helvetica')
      .fillColor('#555')
      .text(` · ${ev.actor?.email ?? 'system'}`);
    doc.font('Helvetica').fontSize(9).fillColor('#333').text(ev.note, { indent: 12 });
    doc.moveDown(0.2);
  });
}

function section(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(title);
  doc.moveDown(0.25);
}

function paragraph(doc: PDFKit.PDFDocument, text: string): void {
  doc.font('Helvetica').fontSize(10).fillColor('#333').text(text, { align: 'justify' });
  doc.moveDown(0.25);
}

function bullet(doc: PDFKit.PDFDocument, label: string, value: string): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#000')
    .text(`${label}:`, { continued: true })
    .font('Helvetica')
    .fillColor('#333')
    .text(` ${value}`);
  doc.moveDown(0.1);
}

function severityColour(sev: BreachSeverity): string {
  switch (sev) {
    case BreachSeverity.LOW:
      return '#166534';
    case BreachSeverity.MEDIUM:
      return '#a16207';
    case BreachSeverity.HIGH:
      return '#c2410c';
    case BreachSeverity.CRITICAL:
      return '#991b1b';
  }
}
