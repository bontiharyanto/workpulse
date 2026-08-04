import ExcelJS from 'exceljs';

import type { RopaExportHeader, RopaExportRow } from './ropa-export-types';

/**
 * Fase 31d — raw-data XLSX export for the ROPA registry.
 *
 * Frozen column order (do NOT reshuffle without a migration guide — some
 * DPOs pipe this file into their own compliance software):
 *
 *   1. slug
 *   2. version
 *   3. name
 *   4. purpose
 *   5. legal_basis
 *   6. legal_basis_detail
 *   7. data_categories
 *   8. subject_categories
 *   9. recipients
 *  10. retention_period
 *  11. cross_border_transfer
 *  12. cross_border_detail
 *  13. security_measures
 *  14. notes
 *  15. published_at
 */
interface Column {
  key: string;
  header: string;
  width: number;
}

const COLUMNS: readonly Column[] = [
  { key: 'slug', header: 'slug', width: 26 },
  { key: 'version', header: 'version', width: 10 },
  { key: 'name', header: 'name', width: 42 },
  { key: 'purpose', header: 'purpose', width: 60 },
  { key: 'legal_basis', header: 'legal_basis', width: 22 },
  { key: 'legal_basis_detail', header: 'legal_basis_detail', width: 44 },
  { key: 'data_categories', header: 'data_categories', width: 40 },
  { key: 'subject_categories', header: 'subject_categories', width: 30 },
  { key: 'recipients', header: 'recipients', width: 44 },
  { key: 'retention_period', header: 'retention_period', width: 44 },
  { key: 'cross_border_transfer', header: 'cross_border_transfer', width: 14 },
  { key: 'cross_border_detail', header: 'cross_border_detail', width: 44 },
  { key: 'security_measures', header: 'security_measures', width: 60 },
  { key: 'notes', header: 'notes', width: 44 },
  { key: 'published_at', header: 'published_at', width: 24 },
];

export async function renderRopaXlsx(
  header: RopaExportHeader,
  rows: readonly RopaExportRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Workpulse';
  wb.created = header.generatedAt;

  const ws = wb.addWorksheet('ROPA', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  const colCount = COLUMNS.length;
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = `Record of Processing Activities — ${header.companyName}`;
  title.font = { bold: true, size: 14 };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell(2, 1).value =
    'Landasan: Pasal 31 UU 27/2022 PDP · GDPR Art. 30 (paralel EU).';

  ws.mergeCells(3, 1, 3, colCount);
  ws.getCell(3, 1).value = `Dicetak: ${header.generatedAt.toISOString()} · Oleh: ${header.generatedByEmail}`;
  ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF666666' } };

  const headerRow = ws.getRow(5);
  headerRow.values = COLUMNS.map((c) => c.header);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEEEEE' },
  };
  headerRow.commit();

  for (const row of rows) {
    const excelRow = ws.addRow({
      slug: row.slug,
      version: row.version,
      name: row.name,
      purpose: row.purpose,
      legal_basis: row.legalBasis,
      legal_basis_detail: row.legalBasisDetail ?? '',
      data_categories: row.dataCategories.join('; '),
      subject_categories: row.subjectCategories.join('; '),
      recipients: row.recipients.join('; '),
      retention_period: row.retentionPeriod,
      cross_border_transfer: row.crossBorderTransfer ? 'YES' : 'NO',
      cross_border_detail: row.crossBorderDetail ?? '',
      security_measures: row.securityMeasures,
      notes: row.notes ?? '',
      published_at: row.publishedAt ? row.publishedAt.toISOString() : '',
    });
    excelRow.alignment = { vertical: 'top', wrapText: true };
    excelRow.commit();
  }

  // Version column right-aligned; long-text columns already wrap.
  ws.getColumn('version').alignment = { horizontal: 'right', vertical: 'top' };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
