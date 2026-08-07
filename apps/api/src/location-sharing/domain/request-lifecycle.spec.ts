import {
  canTransition,
  computeExpiresAt,
  isTerminal,
  LOCATION_SHARE_DAILY_QUOTA_PER_USER,
  LOCATION_SHARE_REQUEST_TTL_MS,
} from './request-lifecycle';

describe('location-sharing request lifecycle', () => {
  describe('computeExpiresAt', () => {
    it('adds exactly 15 minutes to `now`', () => {
      const now = new Date('2026-08-07T10:00:00Z');
      const expires = computeExpiresAt(now);
      expect(expires.getTime() - now.getTime()).toBe(15 * 60 * 1000);
    });

    it('matches the exported TTL constant (guards the ADR-0041 open-question resolution)', () => {
      expect(LOCATION_SHARE_REQUEST_TTL_MS).toBe(15 * 60 * 1000);
    });
  });

  describe('quota constant', () => {
    it('matches ADR-0041 (6 requests / user / 24h)', () => {
      // Locking this in a test so any accidental bump surfaces at PR
      // review — the value has a compliance rationale, not a
      // performance one.
      expect(LOCATION_SHARE_DAILY_QUOTA_PER_USER).toBe(6);
    });
  });

  describe('isTerminal', () => {
    it('PENDING is not terminal', () => {
      expect(isTerminal('PENDING')).toBe(false);
    });

    it.each(['RESPONDED', 'DECLINED', 'EXPIRED', 'CANCELLED'] as const)('%s is terminal', (s) => {
      expect(isTerminal(s)).toBe(true);
    });
  });

  describe('canTransition', () => {
    it('allows PENDING → any terminal', () => {
      expect(canTransition('PENDING', 'RESPONDED')).toBe(true);
      expect(canTransition('PENDING', 'DECLINED')).toBe(true);
      expect(canTransition('PENDING', 'EXPIRED')).toBe(true);
      expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
    });

    it('refuses PENDING → PENDING (no-op cycle would mask a bug)', () => {
      expect(canTransition('PENDING', 'PENDING')).toBe(false);
    });

    it.each([
      ['RESPONDED', 'PENDING'],
      ['DECLINED', 'RESPONDED'],
      ['EXPIRED', 'RESPONDED'],
      ['CANCELLED', 'RESPONDED'],
      ['RESPONDED', 'CANCELLED'],
    ] as const)('refuses transition out of terminal state %s → %s', (from, to) => {
      expect(canTransition(from, to)).toBe(false);
    });
  });
});
