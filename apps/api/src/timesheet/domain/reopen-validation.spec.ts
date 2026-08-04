import { validateReopen } from './reopen-validation';

/**
 * Pure branch coverage for the reopen invariants. No prisma / no fs.
 * Each case documents the intent so a reviewer sees WHY the branch
 * exists, not just what the assertion checks.
 */
describe('validateReopen', () => {
  const okReason = 'Correction — overtime rate revised post-payroll';

  it('accepts an APPROVED row with a proper reason from HR_MANAGER', () => {
    const decision = validateReopen({
      actorRole: 'HR_MANAGER',
      currentStatus: 'APPROVED',
      reasonRaw: `  ${okReason}  `,
    });
    expect(decision.ok).toBe(true);
    expect(decision.reason).toBe(okReason); // trimmed
    expect(decision.issues).toEqual([]);
  });

  it('accepts SUPER_ADMIN with a proper reason', () => {
    const decision = validateReopen({
      actorRole: 'SUPER_ADMIN',
      currentStatus: 'APPROVED',
      reasonRaw: okReason,
    });
    expect(decision.ok).toBe(true);
  });

  it('rejects EMPLOYEE even with a valid reason + APPROVED row', () => {
    const decision = validateReopen({
      actorRole: 'EMPLOYEE',
      currentStatus: 'APPROVED',
      reasonRaw: okReason,
    });
    expect(decision.ok).toBe(false);
    expect(decision.issues).toContain('FORBIDDEN_ROLE');
  });

  it('rejects SUPERVISOR — the reopen is HR-only', () => {
    const decision = validateReopen({
      actorRole: 'SUPERVISOR',
      currentStatus: 'APPROVED',
      reasonRaw: okReason,
    });
    expect(decision.issues).toContain('FORBIDDEN_ROLE');
  });

  it.each(['DRAFT', 'PENDING_SUPERVISOR', 'PENDING_HR', 'REJECTED'] as const)(
    'rejects reopen of a non-APPROVED row (%s)',
    (status) => {
      const decision = validateReopen({
        actorRole: 'HR_MANAGER',
        currentStatus: status,
        reasonRaw: okReason,
      });
      expect(decision.ok).toBe(false);
      expect(decision.issues).toContain('STATUS_NOT_APPROVED');
    },
  );

  it('flags a missing reason as REASON_MISSING (not TOO_SHORT)', () => {
    const decision = validateReopen({
      actorRole: 'HR_MANAGER',
      currentStatus: 'APPROVED',
      reasonRaw: '   ',
    });
    expect(decision.issues).toEqual(['REASON_MISSING']);
  });

  it('flags a reason <10 chars as TOO_SHORT', () => {
    const decision = validateReopen({
      actorRole: 'HR_MANAGER',
      currentStatus: 'APPROVED',
      reasonRaw: 'typo',
    });
    expect(decision.issues).toEqual(['REASON_TOO_SHORT']);
  });

  it('flags a reason >500 chars as TOO_LONG', () => {
    const decision = validateReopen({
      actorRole: 'HR_MANAGER',
      currentStatus: 'APPROVED',
      reasonRaw: 'x'.repeat(501),
    });
    expect(decision.issues).toEqual(['REASON_TOO_LONG']);
  });

  it('accumulates every issue rather than short-circuiting', () => {
    // Employee + wrong status + missing reason — one call surfaces
    // ALL three so the API layer can decide which HTTP code wins.
    const decision = validateReopen({
      actorRole: 'EMPLOYEE',
      currentStatus: 'DRAFT',
      reasonRaw: null,
    });
    expect(decision.issues).toEqual(
      expect.arrayContaining([
        'FORBIDDEN_ROLE',
        'STATUS_NOT_APPROVED',
        'REASON_MISSING',
      ]),
    );
  });
});
