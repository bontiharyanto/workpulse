import {
  computeDbRowsTotal,
  computeStorageTotal,
  formatBytes,
  previousUtcMonth,
  utcMonthRange,
} from './usage-calculator';

describe('computeStorageTotal', () => {
  it('sums two buckets', () => {
    expect(
      computeStorageTotal({ exportBytes: 1024n, dsarBytes: 2048n }),
    ).toBe(3072n);
  });

  it('handles zero cleanly', () => {
    expect(
      computeStorageTotal({ exportBytes: 0n, dsarBytes: 0n }),
    ).toBe(0n);
  });

  it('rejects a synthetic negative total (safety net)', () => {
    expect(() =>
      computeStorageTotal({ exportBytes: -10n, dsarBytes: 0n }),
    ).toThrow(RangeError);
  });
});

describe('computeDbRowsTotal', () => {
  const clean = {
    user: 100,
    attendance: 5000,
    leave: 200,
    overtime: 30,
    timesheetEntry: 1000,
    auditLog: 8000,
    notification: 400,
    timesheetExport: 12,
    webhookDelivery: 42,
  };

  it('sums every table', () => {
    expect(computeDbRowsTotal(clean)).toBe(
      BigInt(100 + 5000 + 200 + 30 + 1000 + 8000 + 400 + 12 + 42),
    );
  });

  it('returns 0 when every table is empty', () => {
    expect(
      computeDbRowsTotal({
        user: 0,
        attendance: 0,
        leave: 0,
        overtime: 0,
        timesheetEntry: 0,
        auditLog: 0,
        notification: 0,
        timesheetExport: 0,
        webhookDelivery: 0,
      }),
    ).toBe(0n);
  });

  it('rejects negative counters', () => {
    expect(() =>
      computeDbRowsTotal({ ...clean, notification: -1 }),
    ).toThrow(RangeError);
  });
});

describe('previousUtcMonth / utcMonthRange', () => {
  it('handles mid-month reference', () => {
    const ref = new Date('2026-04-15T06:00:00Z');
    expect(previousUtcMonth(ref).periodStart.toISOString()).toBe(
      '2026-03-01T00:00:00.000Z',
    );
  });

  it('handles year-boundary reference (January cron)', () => {
    const ref = new Date('2026-01-05T06:00:00Z');
    const { periodStart, periodEnd } = previousUtcMonth(ref);
    expect(periodStart.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('rejects invalid month indices in utcMonthRange', () => {
    expect(() => utcMonthRange(2026, 0)).toThrow(RangeError);
    expect(() => utcMonthRange(2026, 13)).toThrow(RangeError);
  });
});

describe('formatBytes', () => {
  it('renders bytes without a decimal', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
  });

  it('renders KB with 2 decimals for small values', () => {
    expect(formatBytes(2048)).toBe('2.00 KB');
  });

  it('renders MB with 1 decimal', () => {
    expect(formatBytes(50 * 1024 * 1024)).toBe('50.0 MB');
  });

  it('renders GB with 0 decimals when >= 100', () => {
    expect(formatBytes(120 * 1024 * 1024 * 1024)).toBe('120 GB');
  });

  it('handles BigInt inputs', () => {
    expect(formatBytes(1024n * 1024n * 1024n)).toBe('1.00 GB');
  });

  it('returns "—" for garbage input', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
  });
});
