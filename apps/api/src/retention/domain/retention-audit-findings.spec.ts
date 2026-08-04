import {
  deriveRetentionAudit,
  previousUtcMonth,
  utcMonthRange,
  type RetentionAuditCounters,
  type RetentionAuditPolicySnapshot,
} from './retention-audit-findings';

const CLEAN: RetentionAuditCounters = {
  notificationsPruned: 100,
  usersAutoAnonymised: 2,
  dsarArchivesExpired: 5,
  notificationsPastRetention: 0,
  dsarArchivesPastRetention: 0,
  terminatedUsersPastRetention: 0,
};

const STANDARD_POLICY: RetentionAuditPolicySnapshot = {
  notificationRetentionDays: 90,
  dataExportArchiveRetentionHours: 24,
  terminatedUserAnonymizeDays: 365,
};

const PERIOD_START = new Date('2026-03-01T00:00:00Z');
const PERIOD_END = new Date('2026-04-01T00:00:00Z');
const WORKER_TICKED = new Date('2026-03-15T02:00:00Z');

describe('deriveRetentionAudit', () => {
  it('returns SUCCESS with no findings when everything is clean', () => {
    const res = deriveRetentionAudit({
      counters: CLEAN,
      policy: STANDARD_POLICY,
      workerLastRunAt: WORKER_TICKED,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('SUCCESS');
    expect(res.findings).toHaveLength(0);
  });

  it('flags WORKER_INACTIVE when the worker never ticked and policy requires work', () => {
    const res = deriveRetentionAudit({
      counters: CLEAN,
      policy: STANDARD_POLICY,
      workerLastRunAt: null,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('WORKER_INACTIVE');
    expect(res.findings[0]?.kind).toBe('worker_inactive_during_period');
    expect(res.findings[0]?.severity).toBe('critical');
  });

  it('does not flag WORKER_INACTIVE when the policy is "keep forever" (all thresholds 0)', () => {
    // notificationRetentionDays=0 AND terminatedUserAnonymizeDays=0 → worker
    // has legitimately nothing to do. Absence of tick is not a bug.
    const res = deriveRetentionAudit({
      counters: CLEAN,
      policy: {
        notificationRetentionDays: 0,
        dataExportArchiveRetentionHours: 24,
        terminatedUserAnonymizeDays: 0,
      },
      workerLastRunAt: null,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('SUCCESS');
  });

  it('treats a worker tick BEFORE the period as inactive', () => {
    // Cron fired on 2026-02-28 (last day of Feb) but audit period is March.
    const res = deriveRetentionAudit({
      counters: CLEAN,
      policy: STANDARD_POLICY,
      workerLastRunAt: new Date('2026-02-28T23:00:00Z'),
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('WORKER_INACTIVE');
  });

  it('treats a worker tick AFTER the period as inactive (edge — periodEnd exclusive)', () => {
    const res = deriveRetentionAudit({
      counters: CLEAN,
      policy: STANDARD_POLICY,
      // Exactly at periodEnd → excluded by the half-open interval.
      workerLastRunAt: PERIOD_END,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('WORKER_INACTIVE');
  });

  it('flags GAP_DETECTED when notifications past retention linger', () => {
    const res = deriveRetentionAudit({
      counters: { ...CLEAN, notificationsPastRetention: 42 },
      policy: STANDARD_POLICY,
      workerLastRunAt: WORKER_TICKED,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('GAP_DETECTED');
    const finding = res.findings.find(
      (f) => f.kind === 'notifications_past_retention',
    );
    expect(finding?.count).toBe(42);
    expect(finding?.severity).toBe('warning');
  });

  it('escalates DSAR archive gaps to critical severity', () => {
    const res = deriveRetentionAudit({
      counters: { ...CLEAN, dsarArchivesPastRetention: 3 },
      policy: STANDARD_POLICY,
      workerLastRunAt: WORKER_TICKED,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('GAP_DETECTED');
    const finding = res.findings.find(
      (f) => f.kind === 'dsar_archives_past_retention',
    );
    expect(finding?.severity).toBe('critical');
    expect(finding?.count).toBe(3);
  });

  it('WORKER_INACTIVE beats GAP_DETECTED when both are present', () => {
    const res = deriveRetentionAudit({
      counters: { ...CLEAN, notificationsPastRetention: 10 },
      policy: STANDARD_POLICY,
      workerLastRunAt: null,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('WORKER_INACTIVE');
    // Both findings surfaced so the UI can render the full story.
    expect(res.findings).toHaveLength(2);
  });

  it('accumulates multiple gap findings in order', () => {
    const res = deriveRetentionAudit({
      counters: {
        ...CLEAN,
        notificationsPastRetention: 1,
        dsarArchivesPastRetention: 2,
        terminatedUsersPastRetention: 3,
      },
      policy: STANDARD_POLICY,
      workerLastRunAt: WORKER_TICKED,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
    });
    expect(res.status).toBe('GAP_DETECTED');
    expect(res.findings.map((f) => f.kind)).toEqual([
      'notifications_past_retention',
      'dsar_archives_past_retention',
      'terminated_users_past_retention',
    ]);
  });
});

describe('previousUtcMonth', () => {
  it('handles a mid-month reference', () => {
    const ref = new Date('2026-04-15T05:30:00Z');
    const { periodStart, periodEnd } = previousUtcMonth(ref);
    expect(periodStart.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles the January cron (rolls back to December of the prior year)', () => {
    const ref = new Date('2026-01-01T05:30:00Z');
    const { periodStart, periodEnd } = previousUtcMonth(ref);
    expect(periodStart.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('handles a reference exactly at the boundary', () => {
    // Cron happens to fire at second-zero on the 1st.
    const ref = new Date('2026-05-01T00:00:00Z');
    const { periodStart, periodEnd } = previousUtcMonth(ref);
    expect(periodStart.toISOString()).toBe('2026-04-01T00:00:00.000Z');
    expect(periodEnd.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });
});

describe('utcMonthRange', () => {
  it('produces the same range as previousUtcMonth', () => {
    const explicit = utcMonthRange(2026, 3);
    expect(explicit.periodStart.toISOString()).toBe('2026-03-01T00:00:00.000Z');
    expect(explicit.periodEnd.toISOString()).toBe('2026-04-01T00:00:00.000Z');
  });

  it('handles December (rollover to next year)', () => {
    const explicit = utcMonthRange(2026, 12);
    expect(explicit.periodStart.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(explicit.periodEnd.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects out-of-range months', () => {
    expect(() => utcMonthRange(2026, 0)).toThrow(RangeError);
    expect(() => utcMonthRange(2026, 13)).toThrow(RangeError);
  });
});
