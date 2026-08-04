import {
  addDays,
  ALLOWED_STATUS_TRANSITIONS,
  canBeActive,
  canTransition,
  computeDueReminders,
  computeInitialNextReviewAt,
  CONTRACT_EXPIRY_LEAD_DAYS,
  daysUntil,
  DEFAULT_REVIEW_INTERVAL_DAYS,
  REVIEW_REMINDER_LEAD_DAYS,
} from './vendor-review-cadence';

const at = (iso: string) => new Date(iso);

describe('vendor-review-cadence', () => {
  describe('daysUntil', () => {
    it('returns 0 for same calendar day (UTC)', () => {
      expect(daysUntil(at('2026-08-04T00:00:00Z'), at('2026-08-04T23:59:59Z'))).toBe(0);
    });

    it('returns positive integer for future dates', () => {
      expect(daysUntil(at('2026-08-04T00:00:00Z'), at('2026-08-14T12:00:00Z'))).toBe(10);
    });

    it('returns negative integer for past dates', () => {
      expect(daysUntil(at('2026-08-04T00:00:00Z'), at('2026-07-25T12:00:00Z'))).toBe(-10);
    });
  });

  describe('addDays', () => {
    it('adds days without mutating the input', () => {
      const base = at('2026-08-04T00:00:00Z');
      const result = addDays(base, 30);
      expect(result.toISOString()).toBe('2026-09-03T00:00:00.000Z');
      expect(base.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    });
  });

  describe('computeInitialNextReviewAt', () => {
    it('uses contractStartAt when provided', () => {
      const now = at('2026-08-04T00:00:00Z');
      const contractStart = at('2026-01-01T00:00:00Z');
      const nextReview = computeInitialNextReviewAt(now, contractStart);
      expect(daysUntil(contractStart, nextReview)).toBe(DEFAULT_REVIEW_INTERVAL_DAYS);
    });

    it('falls back to now when contractStartAt is null', () => {
      const now = at('2026-08-04T00:00:00Z');
      const nextReview = computeInitialNextReviewAt(now, null);
      expect(daysUntil(now, nextReview)).toBe(DEFAULT_REVIEW_INTERVAL_DAYS);
    });
  });

  describe('computeDueReminders', () => {
    const baseVendor = {
      status: 'ACTIVE' as const,
      nextReviewAt: at('2027-01-01T00:00:00Z'),
      contractEndAt: null,
    };
    const now = at('2026-08-04T00:00:00Z');

    it('returns no reminders when nothing is due', () => {
      // review is >150d out, no contract end
      const res = computeDueReminders(now, baseVendor);
      expect(res).toEqual([]);
    });

    it('skips reminders for TERMINATED vendors even when overdue', () => {
      const res = computeDueReminders(now, {
        ...baseVendor,
        status: 'TERMINATED',
        nextReviewAt: at('2025-01-01T00:00:00Z'),
        contractEndAt: at('2025-01-01T00:00:00Z'),
      });
      expect(res).toEqual([]);
    });

    it('skips reminders for DEPRECATED vendors', () => {
      const res = computeDueReminders(now, {
        ...baseVendor,
        status: 'DEPRECATED',
        nextReviewAt: at('2026-08-10T00:00:00Z'),
        contractEndAt: at('2026-09-01T00:00:00Z'),
      });
      expect(res).toEqual([]);
    });

    it('fires REVIEW_DUE with warning severity when within lead time', () => {
      const nextReview = addDays(now, REVIEW_REMINDER_LEAD_DAYS - 1);
      const res = computeDueReminders(now, { ...baseVendor, nextReviewAt: nextReview });
      expect(res).toHaveLength(1);
      expect(res[0]!.kind).toBe('REVIEW_DUE');
      expect(res[0]!.severity).toBe('warning');
      expect(res[0]!.daysUntil).toBe(REVIEW_REMINDER_LEAD_DAYS - 1);
    });

    it('fires REVIEW_DUE with critical severity once overdue', () => {
      const nextReview = addDays(now, -5);
      const res = computeDueReminders(now, { ...baseVendor, nextReviewAt: nextReview });
      expect(res).toHaveLength(1);
      expect(res[0]!.severity).toBe('critical');
      expect(res[0]!.daysUntil).toBe(-5);
    });

    it('fires CONTRACT_EXPIRING when contract end is within 60 days', () => {
      const contractEnd = addDays(now, CONTRACT_EXPIRY_LEAD_DAYS - 10);
      const res = computeDueReminders(now, { ...baseVendor, contractEndAt: contractEnd });
      expect(res).toHaveLength(1);
      expect(res[0]!.kind).toBe('CONTRACT_EXPIRING');
      expect(res[0]!.severity).toBe('warning');
    });

    it('fires both REVIEW_DUE and CONTRACT_EXPIRING when both are near cutoff', () => {
      const nextReview = addDays(now, 10);
      const contractEnd = addDays(now, 20);
      const res = computeDueReminders(now, {
        ...baseVendor,
        nextReviewAt: nextReview,
        contractEndAt: contractEnd,
      });
      const kinds = res.map((r) => r.kind).sort();
      expect(kinds).toEqual(['CONTRACT_EXPIRING', 'REVIEW_DUE']);
    });

    it('uses stored dates as expectedFor to key the dedup', () => {
      const nextReview = addDays(now, 10);
      const res = computeDueReminders(now, { ...baseVendor, nextReviewAt: nextReview });
      expect(res[0]!.expectedFor.toISOString()).toBe(nextReview.toISOString());
    });
  });

  describe('canTransition', () => {
    it('allows the documented transitions', () => {
      expect(canTransition('UNDER_REVIEW', 'ACTIVE')).toBe(true);
      expect(canTransition('UNDER_REVIEW', 'TERMINATED')).toBe(true);
      expect(canTransition('ACTIVE', 'DEPRECATED')).toBe(true);
      expect(canTransition('ACTIVE', 'TERMINATED')).toBe(true);
      expect(canTransition('DEPRECATED', 'ACTIVE')).toBe(true);
      expect(canTransition('DEPRECATED', 'TERMINATED')).toBe(true);
    });

    it('is idempotent for the same state', () => {
      expect(canTransition('ACTIVE', 'ACTIVE')).toBe(true);
      expect(canTransition('TERMINATED', 'TERMINATED')).toBe(true);
    });

    it('locks TERMINATED as a terminal state', () => {
      expect(canTransition('TERMINATED', 'ACTIVE')).toBe(false);
      expect(canTransition('TERMINATED', 'DEPRECATED')).toBe(false);
      expect(canTransition('TERMINATED', 'UNDER_REVIEW')).toBe(false);
    });

    it('forbids reverting to UNDER_REVIEW from anywhere else', () => {
      expect(canTransition('ACTIVE', 'UNDER_REVIEW')).toBe(false);
      expect(canTransition('DEPRECATED', 'UNDER_REVIEW')).toBe(false);
    });
  });

  describe('canBeActive', () => {
    it('rejects when the DPA is unsigned', () => {
      expect(canBeActive(null)).toBe(false);
    });

    it('accepts when the DPA is signed', () => {
      expect(canBeActive(at('2026-01-01T00:00:00Z'))).toBe(true);
    });
  });

  describe('ALLOWED_STATUS_TRANSITIONS', () => {
    it('has a self-consistent shape (TERMINATED is terminal)', () => {
      expect(ALLOWED_STATUS_TRANSITIONS.TERMINATED).toHaveLength(0);
    });
  });
});
