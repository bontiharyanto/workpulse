import {
  PayrollLockedError,
  assertPayrollNotLocked,
  isMutationBlockedByPayrollLock,
  isPayrollLocked,
} from './payroll-lock';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

describe('isPayrollLocked', () => {
  it('returns false when the cutoff is null or undefined', () => {
    expect(isPayrollLocked(d('2026-08-01'), null)).toBe(false);
    expect(isPayrollLocked(d('2026-08-01'), undefined)).toBe(false);
  });

  it('is inclusive at the cutoff itself', () => {
    expect(isPayrollLocked(d('2026-07-31'), d('2026-07-31'))).toBe(true);
  });

  it('is false one day after the cutoff', () => {
    expect(isPayrollLocked(d('2026-08-01'), d('2026-07-31'))).toBe(false);
  });

  it('is true for any date before the cutoff', () => {
    expect(isPayrollLocked(d('2020-01-01'), d('2026-07-31'))).toBe(true);
  });
});

describe('isMutationBlockedByPayrollLock', () => {
  const cutoff = d('2026-07-31');

  it('does not block when no cutoff is set', () => {
    expect(isMutationBlockedByPayrollLock(d('2020-01-01'), null, { role: 'HR_MANAGER' })).toBe(
      false,
    );
  });

  it('blocks HR_MANAGER inside the frozen period', () => {
    expect(isMutationBlockedByPayrollLock(d('2026-07-15'), cutoff, { role: 'HR_MANAGER' })).toBe(
      true,
    );
  });

  it('blocks EMPLOYEE and SUPERVISOR too (defense-in-depth even though they cannot hit these endpoints)', () => {
    expect(isMutationBlockedByPayrollLock(d('2026-07-15'), cutoff, { role: 'EMPLOYEE' })).toBe(
      true,
    );
    expect(isMutationBlockedByPayrollLock(d('2026-07-15'), cutoff, { role: 'SUPERVISOR' })).toBe(
      true,
    );
  });

  it('allows SUPER_ADMIN inside the frozen period (emergency override)', () => {
    expect(isMutationBlockedByPayrollLock(d('2026-07-15'), cutoff, { role: 'SUPER_ADMIN' })).toBe(
      false,
    );
  });

  it('does not block anyone AFTER the cutoff', () => {
    expect(isMutationBlockedByPayrollLock(d('2026-08-01'), cutoff, { role: 'HR_MANAGER' })).toBe(
      false,
    );
  });
});

describe('assertPayrollNotLocked', () => {
  const cutoff = d('2026-07-31');

  it('throws PayrollLockedError carrying the ISO cutoff for the FE', () => {
    let caught: unknown;
    try {
      assertPayrollNotLocked(d('2026-07-15'), cutoff, { role: 'HR_MANAGER' });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PayrollLockedError);
    if (caught instanceof PayrollLockedError) {
      expect(caught.code).toBe('PAYROLL_LOCKED');
      expect(caught.cutoffIsoDate).toBe('2026-07-31');
    }
  });

  it('is a no-op when the actor is SUPER_ADMIN', () => {
    expect(() =>
      assertPayrollNotLocked(d('2026-07-15'), cutoff, { role: 'SUPER_ADMIN' }),
    ).not.toThrow();
  });

  it('is a no-op when the cutoff is null', () => {
    expect(() =>
      assertPayrollNotLocked(d('2020-01-01'), null, { role: 'HR_MANAGER' }),
    ).not.toThrow();
  });
});
