import { BreachStatus } from '@prisma/client';

import {
  DEADLINE_REMINDER_BUCKETS,
  MS_PER_HOUR,
  NOTIFICATION_DEADLINE_HOURS,
  bucketFor,
  deadlineFor,
  snapshot,
} from './deadline';

describe('deadlineFor', () => {
  it('anchors 72 hours from detectedAt', () => {
    const detected = new Date('2026-08-01T00:00:00Z');
    const deadline = deadlineFor(detected);
    expect(deadline.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(deadline.getTime() - detected.getTime()).toBe(
      NOTIFICATION_DEADLINE_HOURS * MS_PER_HOUR,
    );
  });
});

describe('bucketFor', () => {
  it.each([
    [72, 'SAFE'],
    [30, 'SAFE'],
    [24, 'WARNING'],
    [12, 'WARNING'],
    [4, 'CRITICAL'],
    [1, 'CRITICAL'],
    [0, 'CRITICAL'],
    [-0.1, 'OVERDUE'],
    [-24, 'OVERDUE'],
  ])('classifies %s hours as %s', (h, expected) => {
    expect(bucketFor(h)).toBe(expected);
  });
});

describe('snapshot', () => {
  const detected = new Date('2026-08-01T00:00:00Z');

  it('active + SAFE early in the window', () => {
    const snap = snapshot(
      detected,
      BreachStatus.DETECTED,
      new Date('2026-08-01T01:00:00Z'),
    );
    expect(snap.active).toBe(true);
    expect(snap.bucket).toBe('SAFE');
    expect(snap.hoursRemaining).toBeCloseTo(71, 5);
    expect(snap.overdue).toBe(false);
  });

  it('WARNING at T-24h', () => {
    const snap = snapshot(
      detected,
      BreachStatus.CONTAINED,
      new Date('2026-08-03T00:00:00Z'),
    );
    expect(snap.bucket).toBe('WARNING');
  });

  it('CRITICAL at T-2h', () => {
    const snap = snapshot(
      detected,
      BreachStatus.DETECTED,
      new Date('2026-08-03T22:00:00Z'),
    );
    expect(snap.bucket).toBe('CRITICAL');
  });

  it('OVERDUE after the 72h window when still pre-notified', () => {
    const snap = snapshot(
      detected,
      BreachStatus.DETECTED,
      new Date('2026-08-04T05:00:00Z'),
    );
    expect(snap.bucket).toBe('OVERDUE');
    expect(snap.overdue).toBe(true);
    expect(snap.hoursRemaining).toBeCloseTo(-5, 5);
  });

  it('inactive once authority-notified — bucket collapses to SAFE', () => {
    const snap = snapshot(
      detected,
      BreachStatus.NOTIFIED_AUTHORITY,
      new Date('2026-08-04T05:00:00Z'),
    );
    expect(snap.active).toBe(false);
    expect(snap.bucket).toBe('SAFE');
    expect(snap.overdue).toBe(false);
  });
});

describe('DEADLINE_REMINDER_BUCKETS', () => {
  it('is ordered from earliest reminder to overdue and covers each stage exactly once', () => {
    const buckets = DEADLINE_REMINDER_BUCKETS.map((b) => b.bucket);
    expect(buckets).toEqual(['WARNING', 'CRITICAL', 'OVERDUE']);
    const triggers = DEADLINE_REMINDER_BUCKETS.map(
      (b) => b.triggerAtHoursRemaining,
    );
    // monotonically decreasing
    for (let i = 1; i < triggers.length; i++) {
      const cur = triggers[i]!;
      const prev = triggers[i - 1]!;
      expect(cur).toBeLessThan(prev);
    }
  });
});
