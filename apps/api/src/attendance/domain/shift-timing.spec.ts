import { evaluateClockIn, evaluateClockOut } from './shift-timing';

const shift = {
  startTime: '09:00',
  endTime: '18:00',
  graceMinutes: 15,
  timezone: 'Asia/Jakarta',
};

const workDate = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15 UTC

describe('evaluateClockIn', () => {
  it('marks ON_TIME when clocking in exactly at shift start', () => {
    // 09:00 Jakarta = 02:00 UTC
    const clockIn = new Date(Date.UTC(2026, 5, 15, 2, 0, 0));
    expect(evaluateClockIn(clockIn, workDate, shift)).toEqual({
      status: 'ON_TIME',
      lateMinutes: 0,
    });
  });

  it('marks ON_TIME within grace window', () => {
    const clockIn = new Date(Date.UTC(2026, 5, 15, 2, 14, 0));
    expect(evaluateClockIn(clockIn, workDate, shift).status).toBe('ON_TIME');
  });

  it('marks LATE past grace window', () => {
    const clockIn = new Date(Date.UTC(2026, 5, 15, 2, 30, 0)); // 09:30 Jakarta, 15 past grace
    const result = evaluateClockIn(clockIn, workDate, shift);
    expect(result.status).toBe('LATE');
    expect(result.lateMinutes).toBe(15);
  });

  it('rounds partial-minute lateness upward', () => {
    const clockIn = new Date(Date.UTC(2026, 5, 15, 2, 15, 1)); // 1 second past grace
    const result = evaluateClockIn(clockIn, workDate, shift);
    expect(result.status).toBe('LATE');
    expect(result.lateMinutes).toBe(1);
  });
});

describe('evaluateClockOut', () => {
  it('reports 0 early-leave when clocking out after shift end', () => {
    const clockOut = new Date(Date.UTC(2026, 5, 15, 11, 5, 0)); // 18:05 Jakarta
    expect(evaluateClockOut(clockOut, workDate, shift).earlyLeaveMinutes).toBe(0);
  });

  it('reports early-leave minutes when leaving before shift end', () => {
    const clockOut = new Date(Date.UTC(2026, 5, 15, 10, 30, 0)); // 17:30 Jakarta
    expect(evaluateClockOut(clockOut, workDate, shift).earlyLeaveMinutes).toBe(30);
  });
});
