import ExcelJS from 'exceljs';

import type { AttendanceReportRow, AttendanceReportSummary } from '../domain/attendance-report';

import type { RendererStream } from './render-context';

const COLUMNS: Array<{
  key: keyof AttendanceReportRow | 'no';
  header: string;
  width: number;
}> = [
  { key: 'no', header: 'No.', width: 5 },
  { key: 'workDate', header: 'Tanggal', width: 12 },
  { key: 'userFullName', header: 'Karyawan', width: 25 },
  { key: 'userEmail', header: 'Email', width: 28 },
  { key: 'departmentName', header: 'Departemen', width: 20 },
  { key: 'shiftName', header: 'Shift', width: 18 },
  { key: 'clockIn', header: 'Masuk', width: 10 },
  { key: 'clockOut', header: 'Keluar', width: 10 },
  { key: 'hoursWorked', header: 'Jam Kerja', width: 11 },
  { key: 'status', header: 'Status', width: 11 },
  { key: 'lateMinutes', header: 'Telat (min)', width: 12 },
  { key: 'earlyLeaveMinutes', header: 'Pulang Cepat (min)', width: 18 },
  { key: 'note', header: 'Catatan', width: 30 },
];

export async function renderAttendanceExcel(
  rows: ReadonlyArray<AttendanceReportRow>,
  summary: AttendanceReportSummary,
  stream: RendererStream,
): Promise<void> {
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: stream.target,
    useSharedStrings: false,
    useStyles: true,
  });
  wb.creator = 'Workpulse';
  wb.created = stream.header.generatedAt;

  const ws = wb.addWorksheet('Kehadiran', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });
  ws.columns = COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // ---- Header block (rows 1..4) ----
  ws.mergeCells(1, 1, 1, COLUMNS.length);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = `${stream.header.title} — ${stream.header.companyName}`;
  titleCell.font = { bold: true, size: 14 };
  titleCell.alignment = { horizontal: 'left' };

  ws.mergeCells(2, 1, 2, COLUMNS.length);
  ws.getCell(2, 1).value = stream.header.subtitle;

  ws.mergeCells(3, 1, 3, COLUMNS.length);
  ws.getCell(3, 1).value =
    `Dicetak: ${stream.header.generatedAt.toISOString()} · Oleh: ${stream.header.generatedByEmail} · Zona: ${stream.header.timezone}`;
  ws.getCell(3, 1).font = { italic: true, color: { argb: 'FF666666' } };

  // Row 4 blank spacer, row 5 = header row
  ws.getRow(5).values = COLUMNS.map((c) => c.header);
  ws.getRow(5).font = { bold: true };
  ws.getRow(5).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEEEEEE' },
  };
  ws.getRow(5).commit();

  // ---- Data rows ----
  rows.forEach((r, idx) => {
    ws.addRow({
      no: idx + 1,
      workDate: r.workDate,
      userFullName: r.userFullName,
      userEmail: r.userEmail,
      departmentName: r.departmentName,
      shiftName: r.shiftName,
      clockIn: r.clockIn,
      clockOut: r.clockOut,
      hoursWorked: r.hoursWorked ?? '',
      status: r.status,
      lateMinutes: r.lateMinutes,
      earlyLeaveMinutes: r.earlyLeaveMinutes,
      note: r.note,
    }).commit();
  });

  // ---- Summary footer ----
  ws.addRow([]).commit();
  const summaryRow = ws.addRow({
    no: '',
    workDate: 'RINGKASAN',
    userFullName: `Baris: ${summary.totalRows}`,
    userEmail: `On-Time: ${summary.onTime}`,
    departmentName: `Late: ${summary.late}`,
    shiftName: `Absent: ${summary.absent}`,
    clockIn: `Cuti: ${summary.onLeave}`,
    clockOut: '',
    hoursWorked: `Σ Jam: ${summary.totalHours}`,
    status: '',
    lateMinutes: `Σ Late: ${summary.totalLateMinutes}m`,
    earlyLeaveMinutes: '',
    note: '',
  });
  summaryRow.font = { bold: true };
  summaryRow.commit();

  await ws.commit();
  await wb.commit();
}
