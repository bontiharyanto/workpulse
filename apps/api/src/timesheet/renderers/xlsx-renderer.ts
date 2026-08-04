import ExcelJS from 'exceljs';

import type {
  PayrollColumn,
  PayrollRow,
} from '../domain/payroll-rows';

export interface XlsxHeader {
  companyName: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date;
  generatedByEmail: string;
  mode: 'SUMMARY' | 'DETAIL';
}

/**
 * Materialise the payroll workbook to an in-memory buffer.
 *
 * We DON'T stream to `res` here (unlike the older `/reports/*` renderers)
 * because the export service needs the full byte-string to compute a
 * SHA-256 BEFORE the audit row commits. Writing to a `PassThrough`
 * stream and tee-ing to a hash is equivalent but noisier; buffering is
 * safe for a payroll export because the payload is bounded by the
 * tenant's user count × entries-per-period.
 */
export async function renderXlsx(
  header: XlsxHeader,
  columns: readonly PayrollColumn[],
  rows: readonly PayrollRow[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Workpulse';
  wb.created = header.generatedAt;

  const sheetName = header.mode === 'SUMMARY' ? 'Payroll — Summary' : 'Payroll — Detail';
  const ws = wb.addWorksheet(sheetName, {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  // ---- Header block (rows 1..4) ----
  const colCount = columns.length;
  ws.mergeCells(1, 1, 1, colCount);
  const title = ws.getCell(1, 1);
  title.value = `Timesheet Payroll — ${header.companyName}`;
  title.font = { bold: true, size: 14 };

  ws.mergeCells(2, 1, 2, colCount);
  ws.getCell(2, 1).value = `${header.periodLabel} (${header.periodStart} → ${header.periodEnd}) · Mode: ${header.mode}`;

  ws.mergeCells(3, 1, 3, colCount);
  ws.getCell(3, 1).value = `Dicetak: ${header.generatedAt.toISOString()} · Oleh: ${header.generatedByEmail}`;
  ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF666666' } };

  // Row 4 blank spacer, row 5 = header row (matches ExcelJS's default
  // header semantics — columns key is set above, we just style it).
  const headerRow = ws.getRow(5);
  headerRow.values = columns.map((c) => c.header);
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEEEEE' },
  };
  headerRow.commit();

  // ---- Data rows ----
  for (const row of rows) {
    const values: Record<string, unknown> = {};
    for (const c of columns) {
      const v = row[c.key];
      values[c.key] = v === null ? '' : v;
    }
    ws.addRow(values).commit();
  }

  // Right-align numeric columns for readability.
  columns.forEach((c, idx) => {
    if (c.numeric) {
      ws.getColumn(idx + 1).alignment = { horizontal: 'right' };
    }
  });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
