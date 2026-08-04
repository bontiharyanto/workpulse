import { planCorrectionApply, type AttendanceRecordSlice } from './apply-correction';

const T = (iso: string): Date => new Date(iso);

function makeExisting(overrides: Partial<AttendanceRecordSlice> = {}): AttendanceRecordSlice {
  return {
    id: overrides.id ?? 'att-1',
    clockInAt: 'clockInAt' in overrides ? (overrides.clockInAt ?? null) : T('2026-08-01T09:00:00Z'),
    clockOutAt:
      'clockOutAt' in overrides ? (overrides.clockOutAt ?? null) : T('2026-08-01T18:00:00Z'),
    deletedAt: overrides.deletedAt ?? null,
  };
}

describe('planCorrectionApply', () => {
  describe('no existing record', () => {
    it('CREATE when both times are requested and consistent', () => {
      const action = planCorrectionApply(null, {
        requestedClockInAt: T('2026-08-01T09:00:00Z'),
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({
        kind: 'CREATE',
        clockInAt: T('2026-08-01T09:00:00Z'),
        clockOutAt: T('2026-08-01T18:00:00Z'),
      });
    });

    it('CONFLICT when only clock-in is requested (would create an incomplete session)', () => {
      const action = planCorrectionApply(null, {
        requestedClockInAt: T('2026-08-01T09:00:00Z'),
        requestedClockOutAt: null,
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'CONFLICT_CLOCK_OUT' });
    });

    it('CONFLICT with INVALID_TIME_ORDER when clock-out precedes clock-in', () => {
      const action = planCorrectionApply(null, {
        requestedClockInAt: T('2026-08-01T18:00:00Z'),
        requestedClockOutAt: T('2026-08-01T09:00:00Z'),
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'INVALID_TIME_ORDER' });
    });

    it('CONFLICT with NO_TIMES_REQUESTED when both times are null', () => {
      const action = planCorrectionApply(null, {
        requestedClockInAt: null,
        requestedClockOutAt: null,
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'NO_TIMES_REQUESTED' });
    });
  });

  describe('existing record with only clock-in (half-punch)', () => {
    const half = makeExisting({ clockOutAt: null });

    it('PATCH fills the missing clockOutAt', () => {
      const action = planCorrectionApply(half, {
        requestedClockInAt: null,
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({
        kind: 'PATCH',
        recordId: 'att-1',
        setClockInAt: null,
        setClockOutAt: T('2026-08-01T18:00:00Z'),
        restoreSoftDeleted: false,
      });
    });

    it('CONFLICT_CLOCK_IN if the request tries to overwrite the existing non-null clock-in with a different value', () => {
      const action = planCorrectionApply(half, {
        requestedClockInAt: T('2026-08-01T08:30:00Z'),
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'CONFLICT_CLOCK_IN' });
    });

    it('treats an identical requested clock-in as idempotent (still patches clockOutAt)', () => {
      const action = planCorrectionApply(half, {
        requestedClockInAt: T('2026-08-01T09:00:00Z'), // same as existing
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({
        kind: 'PATCH',
        recordId: 'att-1',
        setClockInAt: null, // no overwrite
        setClockOutAt: T('2026-08-01T18:00:00Z'),
        restoreSoftDeleted: false,
      });
    });

    it('CONFLICT with INVALID_TIME_ORDER when the requested clock-out precedes the existing clock-in', () => {
      const action = planCorrectionApply(half, {
        requestedClockInAt: null,
        requestedClockOutAt: T('2026-08-01T08:00:00Z'),
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'INVALID_TIME_ORDER' });
    });
  });

  describe('existing complete record', () => {
    const complete = makeExisting();

    it('NO_OP when the correction re-requests the same clock-in/out', () => {
      const action = planCorrectionApply(complete, {
        requestedClockInAt: T('2026-08-01T09:00:00Z'),
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({ kind: 'NO_OP', recordId: 'att-1' });
    });

    it('CONFLICT_CLOCK_OUT when the request wants a different clock-out', () => {
      const action = planCorrectionApply(complete, {
        requestedClockInAt: null,
        requestedClockOutAt: T('2026-08-01T19:00:00Z'),
      });
      expect(action).toEqual({ kind: 'CONFLICT', code: 'CONFLICT_CLOCK_OUT' });
    });
  });

  describe('soft-deleted existing record', () => {
    const softDeleted = makeExisting({
      clockInAt: null,
      clockOutAt: null,
      deletedAt: T('2026-08-01T20:00:00Z'),
    });

    it('PATCH restores + fills both times', () => {
      const action = planCorrectionApply(softDeleted, {
        requestedClockInAt: T('2026-08-01T09:00:00Z'),
        requestedClockOutAt: T('2026-08-01T18:00:00Z'),
      });
      expect(action).toEqual({
        kind: 'PATCH',
        recordId: 'att-1',
        setClockInAt: T('2026-08-01T09:00:00Z'),
        setClockOutAt: T('2026-08-01T18:00:00Z'),
        restoreSoftDeleted: true,
      });
    });
  });
});
