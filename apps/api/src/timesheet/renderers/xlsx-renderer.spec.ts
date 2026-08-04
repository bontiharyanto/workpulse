import ExcelJS from 'exceljs';

import { renderXlsx } from './xlsx-renderer';
import {
  SUMMARY_COLUMNS,
  buildSummaryRow,
  type PayrollSourceTimesheet,
} from '../domain/payroll-rows';


function makeSource(overrides: Partial<PayrollSourceTimesheet> = {}): PayrollSourceTimesheet {
  return {
    userId: 'u1',
    userFullName: 'Ada Lovelace',
    userEmail: 'ada@example.com',
    departmentName: 'Eng',
    overtimeHourlyRate: 50000,
    periodLabel: '2026-01',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-15',
    totals: {
      workingDays: 10,
      regularHours: 80,
      overtimeHours: 2,
      leaveDays: 1,
      absentDays: 0,
      holidays: 0,
      lateMinutes: 15,
      earlyLeaveMinutes: 0,
    },
    entries: [],
    ...overrides,
  };
}

describe('renderXlsx (Fase 32c)', () => {
  it('writes a workbook with a titled worksheet and header row at row 5', async () => {
    const rows = [makeSource(), makeSource({ userId: 'u2', userFullName: 'Bo' })].map(
      buildSummaryRow,
    );
    const buf = await renderXlsx(
      {
        companyName: 'Acme',
        periodLabel: '2026-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-01-15',
        generatedAt: new Date('2026-01-16T00:00:00Z'),
        generatedByEmail: 'hr@acme.test',
        mode: 'SUMMARY',
      },
      SUMMARY_COLUMNS,
      rows,
    );

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
    );
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('no worksheet');
    expect(ws.name).toBe('Payroll — Summary');
    expect(String(ws.getCell(1, 1).value ?? '')).toContain('Acme');
    expect(ws.getRow(5).getCell(1).value).toBe('employee_id');
    // Two data rows below.
    expect(ws.getRow(6).getCell(1).value).toBe('u1');
    expect(ws.getRow(7).getCell(1).value).toBe('u2');
  });
});
