import {
  mandatoryNotificationTypes,
  resolveEffective,
  sanitizePreferenceUpdates,
} from './preferences';

describe('notification preferences — resolveEffective', () => {
  it('defaults both channels to ON when no row exists', () => {
    expect(resolveEffective('LEAVE_APPROVED_HR', null)).toEqual({
      emailEnabled: true,
      inAppEnabled: true,
    });
    expect(resolveEffective('OVERTIME_APPROVED', undefined)).toEqual({
      emailEnabled: true,
      inAppEnabled: true,
    });
  });

  it('respects row values for opt-outable types', () => {
    expect(
      resolveEffective('LEAVE_REJECTED', {
        type: 'LEAVE_REJECTED',
        emailEnabled: false,
        inAppEnabled: true,
      }),
    ).toEqual({ emailEnabled: false, inAppEnabled: true });
    expect(
      resolveEffective('OVERTIME_CANCELLED', {
        type: 'OVERTIME_CANCELLED',
        emailEnabled: false,
        inAppEnabled: false,
      }),
    ).toEqual({ emailEnabled: false, inAppEnabled: false });
  });

  it('forces mandatory types ON even when the row says both OFF', () => {
    for (const t of mandatoryNotificationTypes) {
      expect(
        resolveEffective(t, {
          type: t,
          emailEnabled: false,
          inAppEnabled: false,
        }),
      ).toEqual({ emailEnabled: true, inAppEnabled: true });
    }
  });

  it('lists PASSWORD_RESET as a mandatory type (security invariant)', () => {
    // Explicit sentinel — if this ever fails, someone accidentally
    // removed PASSWORD_RESET from the mandatory set. That's a
    // policy-level change and should be caught in review, not by
    // silently making password resets opt-outable.
    expect(mandatoryNotificationTypes.has('PASSWORD_RESET')).toBe(true);
  });
});

describe('notification preferences — sanitizePreferenceUpdates', () => {
  it('drops mandatory types from a bulk update payload', () => {
    const cleaned = sanitizePreferenceUpdates([
      { type: 'LEAVE_APPROVED_HR', emailEnabled: false, inAppEnabled: true },
      { type: 'PASSWORD_RESET', emailEnabled: false, inAppEnabled: false },
    ]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0]?.type).toBe('LEAVE_APPROVED_HR');
  });

  it('dedupes on type with last-write-wins semantics', () => {
    const cleaned = sanitizePreferenceUpdates([
      { type: 'OVERTIME_APPROVED', emailEnabled: true, inAppEnabled: true },
      { type: 'OVERTIME_APPROVED', emailEnabled: false, inAppEnabled: false },
    ]);
    expect(cleaned).toEqual([
      { type: 'OVERTIME_APPROVED', emailEnabled: false, inAppEnabled: false },
    ]);
  });

  it('is a no-op on an empty list', () => {
    expect(sanitizePreferenceUpdates([])).toEqual([]);
  });
});
