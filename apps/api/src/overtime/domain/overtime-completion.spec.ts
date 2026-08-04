import {
  decideOvertimeCompletion,
  type OvertimeCompletionInput,
} from './overtime-completion';

function baseInput(
  overrides: Partial<OvertimeCompletionInput> = {},
): OvertimeCompletionInput {
  return {
    status: 'APPROVED',
    workDate: new Date('2026-08-01T00:00:00Z'),
    now: new Date('2026-08-05T02:00:00Z'), // 4 full days after workDate
    graceDays: 2,
    attendance: {
      clockInAt: new Date('2026-08-01T09:00:00Z'),
      clockOutAt: new Date('2026-08-01T20:30:00Z'),
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('decideOvertimeCompletion', () => {
  it('promotes a well-formed request', () => {
    expect(decideOvertimeCompletion(baseInput())).toEqual({ kind: 'ELIGIBLE' });
  });

  it('skips a request that is already COMPLETED (idempotent)', () => {
    expect(decideOvertimeCompletion(baseInput({ status: 'COMPLETED' }))).toEqual({
      kind: 'SKIP',
      reason: 'ALREADY_COMPLETED',
    });
  });

  it('skips a request that is not APPROVED (PENDING/REJECTED/CANCELLED)', () => {
    for (const status of ['PENDING_APPROVAL', 'REJECTED', 'CANCELLED']) {
      expect(decideOvertimeCompletion(baseInput({ status }))).toEqual({
        kind: 'SKIP',
        reason: 'NOT_APPROVED',
      });
    }
  });

  it('skips when today is still within the grace window', () => {
    // workDate = 2026-08-01, grace = 2 → earliest complete on 2026-08-04.
    // now = 2026-08-03 → not eligible yet.
    expect(
      decideOvertimeCompletion(
        baseInput({ now: new Date('2026-08-03T23:59:59Z') }),
      ),
    ).toEqual({ kind: 'SKIP', reason: 'GRACE_NOT_MET' });
  });

  it('skips when there is no attendance record at all', () => {
    expect(decideOvertimeCompletion(baseInput({ attendance: null }))).toEqual({
      kind: 'SKIP',
      reason: 'NO_ATTENDANCE',
    });
  });

  it('skips when the attendance row was soft-deleted', () => {
    expect(
      decideOvertimeCompletion(
        baseInput({
          attendance: {
            clockInAt: new Date('2026-08-01T09:00:00Z'),
            clockOutAt: new Date('2026-08-01T18:00:00Z'),
            deletedAt: new Date('2026-08-02T00:00:00Z'),
          },
        }),
      ),
    ).toEqual({ kind: 'SKIP', reason: 'NO_ATTENDANCE' });
  });

  it('skips when the user clocked in but never clocked out', () => {
    expect(
      decideOvertimeCompletion(
        baseInput({
          attendance: {
            clockInAt: new Date('2026-08-01T09:00:00Z'),
            clockOutAt: null,
            deletedAt: null,
          },
        }),
      ),
    ).toEqual({ kind: 'SKIP', reason: 'INCOMPLETE_ATTENDANCE' });
  });

  it('accepts a zero-day grace policy on the exact day after workDate', () => {
    // workDate = 2026-08-01, grace = 0 → eligible starting 2026-08-02.
    expect(
      decideOvertimeCompletion(
        baseInput({ graceDays: 0, now: new Date('2026-08-02T00:00:01Z') }),
      ),
    ).toEqual({ kind: 'ELIGIBLE' });
  });
});
