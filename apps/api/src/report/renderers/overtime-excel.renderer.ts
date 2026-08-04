import ExcelJS from 'exceljs';

import type { RendererStream } from './render-context';
import type { OvertimeReportRow, OvertimeReportTotals } from '../domain/overtime-report';


const CURRENCY_FMT = '#,##0';
const NUMBER_FMT = '#,##0.00';

const COLUMNS: ReadonlyArray<{
  key: keyof OvertimeReportRow | 'decidedAt';
  header: string;
  width: number;
  numFmt?: string;
}> = [
  { key: 'userFullName', header: 'Karyawan', width: 24 },
  { key: 'userEmail', header: 'Email', width: 26 },
  { key: 'departmentName', header: 'Departemen', width: 18 },
  { key: 'workDate', header: 'Tanggal', width: 12 },
  { key: 'dayKind', header: 'Jenis', width: 10 },
  { key: 'hours', header: 'Jam', width: 8, numFmt: NUMBER_FMT },
  { key: 'baseRate', header: 'Tarif Dasar', width: 14, numFmt: CURRENCY_FMT },
  { key: 'rateMultiplier', header: 'Mult.', width: 8, numFmt: NUMBER_FMT },
  { key: 'ratePerHour', header: 'Tarif / Jam', width: 14, numFmt: CURRENCY_FMT },
  { key: 'totalAmount', header: 'Total', width: 14, numFmt: CURRENCY_FMT },
  { key: 'status', header: 'Status', width: 14 },
  { key: 'decidedAt', header: 'Disetujui/Ditolak', width: 22 },
  { key: 'reason', header: 'Alasan', width: 30 },
];

export async function renderOvertimeExcel(
  rows: ReadonlyArray<OvertimeReportRow>,
  totals: OvertimeReportTotals,
  stream: RendererStream,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: stream.target,
    // Streaming writer + shared strings tables can produce oversized files for
    // report exports; disable to keep memory footprint bounded and file size
    // predictable at the cost of slightly larger XML.
    useSharedStrings: false,
    useStyles: true,
  });
  wb.creator = 'Workpulse';
  wb.created = stream.header.generatedAt;

  const ws = wb.addWorksheet('Lembur', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: c.numFmt ? { numFmt: c.numFmt } : undefined,
  }));

  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const title = ws.getCell(1, 1);
  title.value = `${stream.header.title} — ${stream.header.companyName}`;
  title.font = { bold: true, size: 14 };

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
    ws.addRow({
      userFullName: r.userFullName,
      userEmail: r.userEmail,
      departmentName: r.departmentName,
      workDate: r.workDate,
      dayKind: r.dayKind,
      hours: r.hours,
      baseRate: r.baseRate,
      rateMultiplier: r.rateMultiplier,
      ratePerHour: r.ratePerHour,
      totalAmount: r.totalAmount,
      status: r.status,
      decidedAt: r.decidedAt ?? '',
      reason: r.reason,
    }).commit();
  }

  // Blank spacer + totals section — payroll-oriented breakdown for at-a-glance
  // audit. Amounts split by dayKind so HR can spot classification mistakes fast.
  ws.addRow([]).commit();
  const totalRow = ws.addRow({
    userFullName: 'RINGKASAN',
    userEmail: `Pengajuan: ${totals.requestCount}`,
    departmentName: `Karyawan: ${totals.users}`,
    workDate: '',
    dayKind: '',
    hours: totals.totalHours,
    baseRate: '',
    rateMultiplier: '',
    ratePerHour: '',
    totalAmount: totals.totalAmount,
    status: '',
    decidedAt: '',
    reason: '',
  });
  totalRow.font = { bold: true };
  totalRow.commit();

  for (const kind of ['WEEKDAY', 'WEEKEND', 'HOLIDAY'] as const) {
    ws.addRow({
      userFullName: `  · ${kind}`,
      userEmail: '',
      departmentName: '',
      workDate: '',
      dayKind: '',
      hours: totals.hoursByDayKind[kind],
      baseRate: '',
      rateMultiplier: '',
      ratePerHour: '',
      totalAmount: totals.amountByDayKind[kind],
      status: '',
      decidedAt: '',
      reason: '',
    }).commit();
  }

  await ws.commit();
  await wb.commit();
}
