import { renderCsv } from './csv-renderer';
import type { PayrollColumn, PayrollRow } from '../domain/payroll-rows';

const cols: PayrollColumn[] = [
  { key: 'employeeId', header: 'employee_id', width: 20 },
  { key: 'employeeName', header: 'employee_name', width: 20 },
  { key: 'regularHours', header: 'regular_hours', width: 12, numeric: true },
];

function buildRow(overrides: Partial<PayrollRow> = {}): PayrollRow {
  return {
    employeeId: 'u1',
    employeeCode: null,
    employeeName: 'Ada',
    employeeEmail: 'ada@example.com',
    departmentName: 'Eng',
    periodLabel: '2026-01',
    periodStart: '2026-01-01',
    periodEnd: '2026-01-15',
    workingDays: 10,
    regularHours: 80,
    overtimeHours: 0,
    leaveDays: 0,
    absentDays: 0,
    holidays: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeHourlyRate: null,
    overtimePayEstimate: 0,
    workDate: null,
    entryKind: null,
    expectedHours: null,
    entryRegularHours: null,
    entryOvertimeHours: null,
    entryLeaveHours: null,
    entryLateMinutes: null,
    entryEarlyLeaveMinutes: null,
    entryNote: null,
    ...overrides,
  };
}

describe('renderCsv (Fase 32c)', () => {
  it('emits UTF-8 BOM + CRLF line endings', () => {
    const buf = renderCsv(cols, [buildRow()]);
    // BOM is the first codepoint
    expect(buf[0]).toBe(0xef);
    expect(buf[1]).toBe(0xbb);
    expect(buf[2]).toBe(0xbf);
    // CRLF between header + row + trailing
    const s = buf.toString('utf8');
    expect(s.split('\r\n').length).toBe(3);
  });

  it('quotes fields containing comma, quote, or newline', () => {
    const buf = renderCsv(cols, [
      buildRow({
        employeeName: 'Doe, John "Ada"',
        employeeId: 'line\nbreak',
      }),
    ]);
    const body = buf.toString('utf8').replace('\uFEFF', '');
    expect(body).toContain('"Doe, John ""Ada"""');
    expect(body).toContain('"line\nbreak"');
  });

  it('emits numbers unquoted', () => {
    const buf = renderCsv(cols, [buildRow({ regularHours: 42.5 })]);
    const body = buf.toString('utf8').replace('\uFEFF', '');
    const row = body.split('\r\n')[1] ?? '';
    expect(row.endsWith('42.5')).toBe(true);
  });

  it('emits empty cell for null / undefined', () => {
    const buf = renderCsv(cols, [buildRow({ regularHours: null })]);
    const body = buf.toString('utf8').replace('\uFEFF', '');
    expect(body.split('\r\n')[1]?.endsWith(',')).toBe(true);
  });

  it('is deterministic — same input → identical bytes', () => {
    const rows = [buildRow(), buildRow({ employeeName: 'Bo' })];
    const a = renderCsv(cols, rows);
    const b = renderCsv(cols, rows);
    expect(a.equals(b)).toBe(true);
  });

  it('handles unicode content correctly (Indonesian names, symbols)', () => {
    const buf = renderCsv(cols, [buildRow({ employeeName: 'Yusuf Nur Iman · Rp💰' })]);
    const body = buf.toString('utf8').replace('\uFEFF', '');
    expect(body).toContain('Yusuf Nur Iman · Rp💰');
  });
});
