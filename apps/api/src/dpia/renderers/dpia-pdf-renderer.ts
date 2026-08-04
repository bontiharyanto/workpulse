import { PassThrough } from 'node:stream';

import type { DpiaAssessment, DpiaRiskItem} from '@prisma/client';
import { DpiaRiskLevel } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { scoreOf, summariseResidual } from '../domain/risk-scoring';

export interface DpiaPdfHeader {
  companyName: string;
  generatedAt: Date;
  ropaActivitySlug: string;
  ropaActivityName: string;
}

type WithItems = DpiaAssessment & { riskItems: DpiaRiskItem[] };

/**
 * Fase 31e — DPIA export renderer.
 *
 * Section layout (matches Art. 35(7) of the GDPR):
 *   1. Metadata & provenance (title, status, DPO, approver)
 *   2. Scope + necessity narrative
 *   3. Risk register table (ordinal, title, inherent, mitigations, residual)
 *   4. Residual summary
 *   5. Conclusion + audit trail
 *
 * Buffer-first so the export service can SHA-256 the payload and audit
 * BEFORE the caller receives any bytes.
 */
export async function renderDpiaPdf(header: DpiaPdfHeader, assessment: WithItems): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 48, bottom: 48, left: 48, right: 48 },
      info: {
        Title: `DPIA — ${assessment.title}`,
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

    drawTitle(doc, header, assessment);
    drawNarrative(doc, assessment);
    drawRiskRegister(doc, assessment.riskItems);
    drawSummary(doc, assessment);

    doc.end();
  });
}

function drawTitle(doc: PDFKit.PDFDocument, header: DpiaPdfHeader, a: WithItems): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(18)
    .fillColor('#000')
    .text('Data Protection Impact Assessment (DPIA)');
  doc
    .font('Helvetica')
    .fontSize(11)
    .fillColor('#333')
    .text('Penilaian Dampak Perlindungan Data Pribadi');
  doc.moveDown(0.5);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor('#555')
    .text(`Perusahaan: ${header.companyName}`)
    .text(`Aktivitas ROPA: ${header.ropaActivityName} (${header.ropaActivitySlug})`)
    .text(`Status: ${a.status}`)
    .text(`Dibuat: ${a.createdAt.toISOString()}`)
    .text(`Disetujui: ${a.approvedAt ? a.approvedAt.toISOString() : '—'}`)
    .text(`Digenerate: ${header.generatedAt.toISOString()}`);
  doc.moveDown(0.75);
  doc.strokeColor('#000').lineWidth(0.5).moveTo(48, doc.y).lineTo(547, doc.y).stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(a.title);
  doc.moveDown(0.75);
}

function drawNarrative(doc: PDFKit.PDFDocument, a: WithItems): void {
  section(doc, 'Ruang Lingkup (Scope)');
  paragraph(doc, a.scope);
  section(doc, 'Kebutuhan & Proporsionalitas (Necessity)');
  paragraph(doc, a.necessity);
  if (a.dpoOpinion) {
    section(doc, 'Pendapat DPO (DPO Opinion)');
    paragraph(doc, a.dpoOpinion);
  }
}

function drawRiskRegister(doc: PDFKit.PDFDocument, items: readonly DpiaRiskItem[]): void {
  section(doc, 'Registrasi Risiko (Risk Register)');
  if (items.length === 0) {
    doc
      .font('Helvetica-Oblique')
      .fontSize(10)
      .fillColor('#555')
      .text('Belum ada risiko yang teridentifikasi pada DPIA ini.');
    doc.moveDown(1);
    return;
  }
  items.forEach((r, idx) => {
    if (idx > 0) doc.moveDown(0.75);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(`${r.ordinal}. ${r.title}`);
    doc.font('Helvetica').fontSize(10).fillColor('#333').text(r.description, { paragraphGap: 4 });
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000')
      .text('Skor Inherent:', { continued: true })
      .font('Helvetica')
      .text(
        ` L=${r.likelihood} × I=${r.impact} = ${scoreOf(r.likelihood, r.impact)} → ${r.inherentLevel}`,
      );
    doc
      .font('Helvetica-Bold')
      .text('Mitigasi:', { continued: true })
      .font('Helvetica')
      .text(` ${r.mitigations}`);
    doc
      .font('Helvetica-Bold')
      .text('Skor Residual:', { continued: true })
      .font('Helvetica')
      .fillColor(levelColour(r.residualLevel))
      .text(
        ` L=${r.residualLikelihood} × I=${r.residualImpact} = ${scoreOf(
          r.residualLikelihood,
          r.residualImpact,
        )} → ${r.residualLevel}`,
      )
      .fillColor('#000');
  });
  doc.moveDown(0.75);
}

function drawSummary(doc: PDFKit.PDFDocument, a: WithItems): void {
  const worst = summariseResidual(a.riskItems);
  section(doc, 'Ringkasan Risiko Residual');
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(levelColour(worst))
    .text(`Level tertinggi (max residual): ${worst}`);
  doc.fillColor('#000');
  if (a.conclusion) {
    section(doc, 'Kesimpulan');
    paragraph(doc, a.conclusion);
  }
  section(doc, 'Provenance');
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#555')
    .text(`Assessment ID: ${a.id}`)
    .text(`Dibuat oleh: ${a.createdById ?? '—'}`)
    .text(`Direview oleh: ${a.reviewedById ?? '—'} pada ${a.reviewedAt?.toISOString() ?? '—'}`)
    .text(`Disetujui oleh: ${a.approvedById ?? '—'} pada ${a.approvedAt?.toISOString() ?? '—'}`);
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

function levelColour(level: DpiaRiskLevel): string {
  switch (level) {
    case DpiaRiskLevel.LOW:
      return '#166534';
    case DpiaRiskLevel.MEDIUM:
      return '#a16207';
    case DpiaRiskLevel.HIGH:
      return '#c2410c';
    case DpiaRiskLevel.CRITICAL:
      return '#991b1b';
  }
}
