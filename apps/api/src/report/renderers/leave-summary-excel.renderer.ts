import ExcelJS from 'exceljs';

import type { RendererStream } from './render-context';
import type { LeaveSummaryReportRow, LeaveSummaryTotals } from '../domain/leave-summary-report';


const COLUMNS = [
  { key: 'userFullName', header: 'Karyawan', width: 25 },
  { key: 'userEmail', header: 'Email', width: 28 },
  { key: 'departmentName', header: 'Departemen', width: 20 },
  { key: 'leaveTypeCode', header: 'Kode', width: 10 },
  { key: 'leaveTypeName', header: 'Tipe Cuti', width: 22 },
  { key: 'year', header: 'Tahun', width: 8 },
  { key: 'quota', header: 'Kuota', width: 8 },
  { key: 'carriedOver', header: 'Carry-Over', width: 12 },
  { key: 'used', header: 'Terpakai', width: 10 },
  { key: 'reserved', header: 'Reserved', width: 10 },
  { key: 'remaining', header: 'Sisa', width: 10 },
] as const;

export async function renderLeaveSummaryExcel(
  rows: ReadonlyArray<LeaveSummaryReportRow>,
  totals: LeaveSummaryTotals,
  stream: RendererStream,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: stream.target,
    useSharedStrings: false,
    useStyles: true,
  });
  wb.creator = 'Workpulse';
  wb.created = stream.header.generatedAt;

  const ws = wb.addWorksheet('Ringkasan Cuti', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const t = ws.getCell(1, 1);
  t.value = `${stream.header.title} — ${stream.header.companyName}`;
  t.font = { bold: true, size: 14 };

  ws.mergeCells(2, 1, 2, COLUMNS.length);
  ws.getCell(2, 1).value = stream.header.subtitle;

  ws.mergeCells(3, 1, 3, COLUMNS.length);
  ws.getCell(3, 1).value =
    `Dicetak: ${stream.header.generatedAt.toISOString()} · Oleh: ${stream.header.generatedByEmail}`;
  ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF666666' } };

  ws.getRow(5).values = COLUMNS.map((c) => c.header);
  ws.getRow(5).font = { bold: true };
  ws.getRow(5).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEEEEE' },
  };
  ws.getRow(5).commit();

  for (const r of rows) {
    ws.addRow(r).commit();
  }

  ws.addRow([]).commit();
  const summary = ws.addRow({
    userFullName: 'RINGKASAN',
    userEmail: `Karyawan: ${totals.users}`,
    departmentName: `Tipe: ${totals.leaveTypes}`,
    leaveTypeCode: '',
    leaveTypeName: '',
    year: '',
    quota: totals.totalQuota,
    carriedOver: '',
    used: totals.totalUsed,
    reserved: totals.totalReserved,
    remaining: totals.totalRemaining,
  });
  summary.font = { bold: true };
  summary.commit();

  await ws.commit();
  await wb.commit();
}
